import { createHash } from 'node:crypto';
import { IntakeError, readJson, whileActive } from './intake.ts';
import { githubRepository } from './github.ts';

export type StagedGitObject = { type: 'blob' | 'tree' | 'commit'; sha: string; content: string };
type Request = (path: string, body: unknown, signal: AbortSignal) => Promise<unknown>;
const invalid = () => new IntakeError(409, 'Staged Git objects are invalid or do not match GitHub.');
const hash = (type: string, bytes: Buffer) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');

/** Reproduce the already validated staged Git objects; the caller reauthorizes each write. */
export async function writeStagedGitObjects(objects: StagedGitObject[], request: Request, authorize: () => Promise<void>, signal: AbortSignal) {
  if (!Array.isArray(objects) || !objects.length || objects.length > 4121) throw invalid();
  const ready: Array<{ type: StagedGitObject['type']; sha: string; body: unknown }> = [];
  for (const object of objects) {
    if (!object || !['blob','tree','commit'].includes(object.type) || !/^[a-f0-9]{40}$/.test(object.sha)
      || typeof object.content !== 'string' || object.content.length > 1400000) throw invalid();
    const bytes = Buffer.from(object.content, 'base64');
    if (bytes.toString('base64') !== object.content || hash(object.type, bytes) !== object.sha) throw invalid();
    if (object.type === 'blob') ready.push({type:'blob',sha:object.sha,body:{content:object.content,encoding:'base64'}});
    else if (object.type === 'tree') {
      const entries: Array<{path:string;mode:string;type:string;sha:string}> = []; let offset = 0;
      while (offset < bytes.length) {
        const space = bytes.indexOf(32, offset), zero = bytes.indexOf(0, space + 1);
        if (space < offset || zero < space + 2 || zero + 21 > bytes.length) throw invalid();
        const mode = bytes.subarray(offset, space).toString('ascii');
        const rawName = bytes.subarray(space + 1, zero); const path = rawName.toString('utf8');
        if (!Buffer.from(path).equals(rawName) || !path || path.includes('/') || path === '.' || path === '..'
          || path.toLowerCase() === '.git' || /[\x00-\x1f\x7f]/.test(path) || !['40000','100644','100755','120000','160000'].includes(mode)) throw invalid();
        entries.push({path,mode:mode === '40000' ? '040000' : mode,type:mode === '40000' ? 'tree' : mode === '160000' ? 'commit' : 'blob',sha:bytes.subarray(zero+1,zero+21).toString('hex')});
        offset = zero + 21;
      }
      ready.push({type:'tree',sha:object.sha,body:{tree:entries}});
    } else {
      const raw = bytes.toString('utf8');
      if (!Buffer.from(raw).equals(bytes)) throw invalid();
      const match = /^tree ([a-f0-9]{40})\nparent ([a-f0-9]{40})\nauthor TripSit <tripsit@localhost> (\d+) \+0000\ncommitter TripSit <tripsit@localhost> \3 \+0000\n\nStage candidate\n$/.exec(raw);
      if (!match || !Number.isSafeInteger(Number(match[3]))) throw invalid();
      const date = new Date(Number(match[3]) * 1000); if (!Number.isFinite(date.getTime())) throw invalid();
      const actor = {name:'TripSit',email:'tripsit@localhost',date:date.toISOString().replace('.000Z','Z')};
      ready.push({type:'commit',sha:object.sha,body:{tree:match[1],parents:[match[2]],message:'Stage candidate\n',author:actor,committer:actor}});
    }
  }
  if (ready.at(-1)?.type !== 'commit' || ready.filter(row => row.type === 'commit').length !== 1) throw invalid();
  for (const row of ready) {
    await whileActive(authorize, signal);
    const response = await whileActive(() => request(`/git/${row.type === 'blob' ? 'blobs' : row.type === 'tree' ? 'trees' : 'commits'}`, row.body, signal), signal);
    if (!response || typeof response !== 'object' || (response as Record<string,unknown>).sha !== row.sha) throw invalid();
  }
  return ready.at(-1)!.sha;
}

/** Bounded GitHub transport. Token must be scoped to the authorized repository. */
export function publicationGitHubTransport(repository: string, token: string, fetcher: typeof fetch = fetch): Request {
  githubRepository(repository);
  if (!token) throw invalid();
  return async (path, body, signal) => {
    if (!['/git/blobs','/git/trees','/git/commits'].includes(path)) throw invalid();
    const active = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
    const response = await whileActive(() => fetcher(`https://api.github.com/repos/${repository}${path}`, {
      method:'POST',redirect:'error',signal:active,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2026-03-10','Content-Type':'application/json'},body:JSON.stringify(body)
    }), active);
    if (!response.ok) { await response.body?.cancel(); throw new IntakeError(502,'GitHub object creation is unavailable.'); }
    return readJson(response, 1048576, active);
  };
}

type RemoteResponse = Record<string, unknown> | unknown[] | null;
export function publicationRemote(repository: string, token: string, fetcher: typeof fetch = fetch) {
  githubRepository(repository);
  if (!token) throw invalid();
  async function call(method: 'GET' | 'POST', path: string, signal: AbortSignal, body?: unknown): Promise<RemoteResponse> {
    const active = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
    try {
      const response = await whileActive(() => fetcher(`https://api.github.com/repos/${repository}${path}`, { method,redirect:'error',signal:active,
        headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2026-03-10','Content-Type':'application/json'},
        ...(body === undefined ? {} : {body:JSON.stringify(body)}) }), active);
      if (response.status === 404 && method === 'GET') { await response.body?.cancel(); return null; }
      if (!response.ok) { await response.body?.cancel(); throw invalid(); }
      const result = await readJson(response, 1048576, active);
      if (!result || typeof result !== 'object') throw invalid();
      return result as RemoteResponse;
    } catch { throw new IntakeError(502,'GitHub publication is unavailable or requires reconciliation.'); }
  }
  return {
    object: publicationGitHubTransport(repository,token,fetcher),
    async issue(number: number, signal: AbortSignal) { return call('GET',`/issues/${number}`,signal); },
    async ref(branch: string, signal: AbortSignal) {
      const value = await call('GET', `/git/ref/heads/${encodeURIComponent(branch)}`,signal);
      if (value === null) return null;
      const object = !Array.isArray(value) && value.object;
      if (!object || typeof object !== 'object' || typeof (object as Record<string,unknown>).sha !== 'string') throw invalid();
      return (object as Record<string,unknown>).sha as string;
    },
    async createRef(branch: string, commit: string, signal: AbortSignal) {
      await call('POST','/git/refs',signal,{ref:`refs/heads/${branch}`,sha:commit});
    },
    async pullRequests(branch: string, base: string, signal: AbortSignal) {
      const query = new URLSearchParams({state:'open',head:`${repository.split('/')[0]}:${branch}`,base,per_page:'100'});
      const value = await call('GET',`/pulls?${query}`,signal);
      if (!Array.isArray(value) || value.length >= 100) throw invalid();
      return value;
    },
    async createPull(branch: string, base: string, title: string, body: string, signal: AbortSignal) {
      return call('POST','/pulls',signal,{head:branch,base,title,body,draft:true});
    }
  };
}
