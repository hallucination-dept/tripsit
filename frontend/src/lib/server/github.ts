export type GitHubAccount = { id: string; userId: string; providerId: string; accountId: string };

export function githubAccount(accounts: GitHubAccount[], owner: string): GitHubAccount {
  const linked = accounts.filter((account) => account.userId === owner && account.providerId === 'github');
  if (linked.length !== 1) throw new Error('Sign in with one linked GitHub account before selecting an issue.');
  return linked[0];
}

import { createHash, createSign } from 'node:crypto';
import { IntakeError, readJson, whileActive } from './intake.ts';
import type { IssueSnapshot } from './intake.ts';

type Options = { appId: string; privateKey: string; userToken: string; accountId: string; fetcher?: typeof fetch };
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IntakeError(502, 'GitHub returned an invalid response.');
  return value as ObjectValue;
}
function id(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new IntakeError(502, 'GitHub returned an invalid identifier.');
  return Number(value);
}
function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > limit) throw new IntakeError(502, 'GitHub returned invalid or oversized content.');
  return value;
}
export function githubRepository(repository: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repository) || ['.', '..'].includes(repository.split('/')[1])) {
    throw new IntakeError(400, 'Select a valid owner/repository.');
  }
  return repository;
}
function contextPath(value: unknown): string {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 1024 || /[\\:\x00-\x1f\x7f]/.test(value) ||
    value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
    throw new IntakeError(400, 'Select safe repository-relative file paths.');
  }
  return value;
}

export type PullRequestFile = { path: string; mode: '100644' | '100755'; content: Buffer | null };
export type PullRequestChange = { branch: string; title: string; body: string; message: string; files: PullRequestFile[] };
export type PullRequest = { number: number; url: string; branch: string };
export type Publisher =
  | { available: true; create: (change: PullRequestChange, signal: AbortSignal) => Promise<PullRequest> }
  | { available: false; reason: string };
export type RepositoryArchive = {
  repository: string; branch: string; sha: string;
  download: (signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>;
  publish: Publisher;
};

// GitHub answers the tarball request with a short-lived redirect to codeload; follow only that host.
async function downloadTarball(fetcher: typeof fetch, repository: string, sha: string, token: string, signal: AbortSignal) {
  const unavailable = () => new IntakeError(502, 'GitHub did not provide the repository archive.');
  const redirect = await fetcher(`https://api.github.com/repos/${repository}/tarball/${sha}`, {
    redirect: 'manual', signal,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2026-03-10' }
  });
  await redirect.body?.cancel();
  let target: URL;
  try { target = new URL(redirect.status === 302 ? redirect.headers.get('location') ?? '' : ''); }
  catch { throw unavailable(); }
  if (target.protocol !== 'https:' || target.hostname !== 'codeload.github.com') throw unavailable();
  const archive = await fetcher(target, { redirect: 'error', signal });
  if (!archive.ok || !archive.body) { await archive.body?.cancel(); throw unavailable(); }
  return archive.body;
}

type TreeEntry = { path: string; sha: string; mode: string; size?: number };
const regular = (entry: TreeEntry) => entry.mode === '100644' || entry.mode === '100755';

function jwt(appId: string, key: string): string {
  const now = Math.floor(Date.now() / 1000);
  const data = [ { alg: 'RS256', typ: 'JWT' }, { iat: now - 60, exp: now + 540, iss: appId } ]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${data}.${createSign('RSA-SHA256').update(data).sign(key).toString('base64url')}`;
}

export function createGitHub(options: Options) {
  async function requestJson(path: string, token: string, signal: AbortSignal, body?: unknown) {
    try {
      signal.throwIfAborted();
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
      const response = await (options.fetcher ?? fetch)(`https://api.github.com${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error',
        signal: deadline,
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new IntakeError([401,403,404].includes(response.status) ? 403 : 502, 'GitHub access is unavailable or no longer authorized.');
      }
      return { value: await readJson(response, 1024 * 1024, deadline),
        hasNext: /<[^>]+>;\s*rel="next"/.test(response.headers.get('Link') ?? '') };
    } catch (cause) {
      if (cause instanceof IntakeError && cause.status === 403) throw cause;
      throw new IntakeError(502, 'GitHub did not complete a valid bounded request.');
    }
  }

  async function request(path: string, token: string, signal: AbortSignal, body?: unknown): Promise<ObjectValue> {
    return object((await requestJson(path, token, signal, body)).value);
  }

  async function verifyUser(signal: AbortSignal) {
    const user = await request('/user', options.userToken, signal);
    if (String(id(user.id)) !== options.accountId) throw new IntakeError(403, 'The linked GitHub identity could not be verified.');
  }

  async function pages(path: string, token: string, signal: AbortSignal, budget: { remaining: number }, field?: string) {
    const rows: unknown[] = [];
    for (let page = 1; budget.remaining > 0; page++) {
      budget.remaining--;
      const result = await requestJson(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, token, signal);
      const values = field ? object(result.value)[field] : result.value;
      if (!Array.isArray(values) || values.length > 100) throw new IntakeError(502, 'GitHub returned an invalid discovery page.');
      rows.push(...values);
      if (!result.hasNext) return { rows, complete: true };
    }
    return { rows, complete: false };
  }

  async function authorize(repository: string, signal: AbortSignal, expectedId?: number, write = false) {
    await verifyUser(signal);
    const repo = await request(`/repos/${repository}`, options.userToken, signal);
    if (write && (!repo.permissions || typeof repo.permissions !== 'object' || (repo.permissions as ObjectValue).push !== true)) throw new IntakeError(403, 'Repository write access is unavailable.');
    const repositoryId = id(repo.id);
    const permissions = repo.permissions && typeof repo.permissions === 'object' ? repo.permissions as ObjectValue : {};
    if (expectedId !== undefined && repositoryId !== expectedId) throw new IntakeError(403, 'Repository identity has changed.');
    const appJwt = jwt(options.appId, options.privateKey);
    const installation = await request(`/repos/${repository}/installation`, appJwt, signal);
    if (String(id(installation.app_id)) !== options.appId || installation.suspended_at !== null) throw new IntakeError(403, 'The GitHub App installation is unavailable.');
    const access = await request(`/app/installations/${id(installation.id)}/access_tokens`, appJwt, signal,
      { repository_ids: [repositoryId], permissions: write ? { contents: 'write', pull_requests: 'write', issues: 'read' } : { contents: 'read', issues: 'read' } });
    const token = text(access.token, 4096);
    const installedRepo = await request(`/repos/${repository}`, token, signal);
    if (id(installedRepo.id) !== repositoryId) throw new IntakeError(403, 'Repository authorization does not match.');
    const canonical = text(installedRepo.full_name, 201);
    if (canonical.toLowerCase() !== repository.toLowerCase() || typeof installedRepo.private !== 'boolean') throw new IntakeError(502, 'GitHub returned invalid repository metadata.');
    return { repositoryId, repository: canonical, private: installedRepo.private, branch: text(installedRepo.default_branch, 255), token,
      installationId: id(installation.id), userCanPush: permissions.push === true };
  }

  type Authorized = Awaited<ReturnType<typeof authorize>>;

  // Opening pull requests needs a separate write token. Installations without write access, or users who cannot
  // push to the repository, still get agent runs; they just do not get a pull request.
  async function publisher(repo: Authorized, sha: string, signal: AbortSignal): Promise<Publisher> {
    if (!repo.userCanPush) return { available: false, reason: 'you do not have write access to this repository' };
    let token: string;
    try {
      const access = await request(`/app/installations/${repo.installationId}/access_tokens`, jwt(options.appId, options.privateKey), signal,
        { repository_ids: [repo.repositoryId], permissions: { contents: 'write', pull_requests: 'write' } });
      token = text(access.token, 4096);
    } catch {
      return { available: false, reason: 'the TripSit GitHub App needs read and write access to Contents and Pull requests' };
    }
    return { available: true, create: (change, publishSignal) => openPullRequest(repo, sha, token, change, publishSignal) };
  }

  // Builds the commit on top of the real base commit with the Git Data API, then opens the pull request.
  async function openPullRequest(repo: Authorized, sha: string, token: string, change: PullRequestChange, signal: AbortSignal): Promise<PullRequest> {
    if (!/^tripsit\/[a-z0-9-]{4,64}$/.test(change.branch) || !change.files.length || change.files.length > 400 ||
        !text(change.title, 256) || !text(change.message, 64 * 1024) || typeof change.body !== 'string' || change.body.length > 60_000) {
      throw new IntakeError(400, 'The pull request input is invalid.');
    }
    const objectSha = (value: unknown) => {
      const result = text(value, 64);
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(result)) throw new IntakeError(502, 'GitHub returned an invalid object identity.');
      return result;
    };
    const base = await request(`/repos/${repo.repository}/git/commits/${sha}`, token, signal);
    const tree: { path: string; mode: string; type: 'blob'; sha: string | null }[] = [];
    for (const file of change.files) {
      contextPath(file.path);
      if (file.mode !== '100644' && file.mode !== '100755') throw new IntakeError(400, 'Only regular files can be published.');
      if (file.content === null) { tree.push({ path: file.path, mode: file.mode, type: 'blob', sha: null }); continue; }
      const blob = await request(`/repos/${repo.repository}/git/blobs`, token, signal, { content: file.content.toString('base64'), encoding: 'base64' });
      tree.push({ path: file.path, mode: file.mode, type: 'blob', sha: objectSha(blob.sha) });
    }
    const nextTree = await request(`/repos/${repo.repository}/git/trees`, token, signal, { base_tree: objectSha(object(base.tree).sha), tree });
    const commit = await request(`/repos/${repo.repository}/git/commits`, token, signal, { message: change.message, tree: objectSha(nextTree.sha), parents: [sha] });
    await request(`/repos/${repo.repository}/git/refs`, token, signal, { ref: `refs/heads/${change.branch}`, sha: objectSha(commit.sha) });
    const pull = await request(`/repos/${repo.repository}/pulls`, token, signal, { title: change.title, head: change.branch, base: repo.branch, body: change.body });
    const url = text(pull.html_url, 2048);
    if (!url.startsWith('https://github.com/')) throw new IntakeError(502, 'GitHub returned an invalid pull request.');
    return { number: id(pull.number), url, branch: change.branch };
  }

  async function frozenTree(snapshot: IssueSnapshot, signal: AbortSignal) {
    githubRepository(snapshot.repository);
    if (typeof snapshot.private !== 'boolean' || !Number.isSafeInteger(snapshot.repositoryId) || snapshot.repositoryId < 1 ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(snapshot.baseSha)) {
      throw new IntakeError(400, 'Select a frozen repository snapshot.');
    }
    const repo = await authorize(snapshot.repository, signal, snapshot.repositoryId);
    const result = await request(`/repos/${repo.repository}/git/trees/${snapshot.baseSha}?recursive=1`, repo.token, signal);
    if (result.truncated !== false || !Array.isArray(result.tree) || result.tree.length > 4096) {
      throw new IntakeError(502, 'GitHub did not return a complete bounded repository tree.');
    }
    const entries = new Map<string, TreeEntry>();
    for (const value of result.tree) {
      const row = object(value);
      const path = contextPath(row.path);
      const sha = text(row.sha, 40);
      const mode = text(row.mode, 6);
      if (!/^[a-f0-9]{40}$/.test(sha) || entries.has(path) ||
          !((['100644', '100755', '120000'].includes(mode) && row.type === 'blob') ||
            (mode === '040000' && row.type === 'tree') || (mode === '160000' && row.type === 'commit'))) {
        throw new IntakeError(502, 'GitHub returned an invalid repository tree.');
      }
      const entry: TreeEntry = { path, sha, mode };
      if (regular(entry)) {
        if (!Number.isSafeInteger(row.size) || Number(row.size) < 0) throw new IntakeError(502, 'GitHub returned an invalid blob size.');
        entry.size = Number(row.size);
      }
      entries.set(path, entry);
    }
    for (const path of entries.keys()) {
      const parts = path.split('/');
      for (let index = 1; index < parts.length; index++) {
        const parent = entries.get(parts.slice(0, index).join('/'));
        if (!parent || parent.mode !== '040000') throw new IntakeError(502, 'GitHub returned conflicting tree paths.');
      }
    }
    return { repo, entries, treeSha: result.sha };
  }

  return {
    publicationAccess: async (repository: string, repositoryId: number, signal: AbortSignal) => authorize(repository, signal, repositoryId, true),
    stagingTree: async (snapshot: IssueSnapshot, signal: AbortSignal) => {
      const { repo, entries, treeSha } = await frozenTree(snapshot, signal);
      const commit = await request(`/repos/${repo.repository}/git/commits/${snapshot.baseSha}`, repo.token, signal);
      const tree = object(commit.tree);
      if (commit.sha !== snapshot.baseSha || typeof treeSha !== 'string' || !/^[a-f0-9]{40}$/.test(treeSha) || tree.sha !== treeSha)
        throw new IntakeError(502, 'GitHub returned an inconsistent base commit tree.');
      return { baseSha: snapshot.baseSha, treeSha, entries: [...entries.values()] };
    },
    files: async (snapshot: IssueSnapshot, signal: AbortSignal): Promise<{ path: string; blobSha: string }[]> => {
      const { entries } = await frozenTree(snapshot, signal);
      return [...entries.values()].filter(regular).map(entry => ({ path: entry.path, blobSha: entry.sha }));
    },
    context: async (snapshot: IssueSnapshot, paths: string[], signal: AbortSignal): Promise<{ path: string; originalBlob: string | null; content: string }[]> => {
      if (!Array.isArray(paths) || paths.length < 1 || paths.length > 8) throw new IntakeError(400, 'Select one to eight context files.');
      paths.forEach(contextPath);
      if (new Set(paths).size !== paths.length || paths.some(path => paths.some(other => other.startsWith(path + '/')))) {
        throw new IntakeError(400, 'Selected context paths conflict.');
      }
      const { repo, entries } = await frozenTree(snapshot, signal);
      let total = 0;
      const context: { path: string; originalBlob: string | null; content: string }[] = [];
      for (const path of paths) {
        const entry = entries.get(path);
        const parts = path.split('/');
        if ((entry && !regular(entry)) || parts.slice(0, -1).some((_, index) => {
          const parent = entries.get(parts.slice(0, index + 1).join('/'));
          return parent && parent.mode !== '040000';
        })) throw new IntakeError(400, 'Context paths must select regular files without parent collisions.');
        if (!entry) { context.push({ path, originalBlob: null, content: '' }); continue; }
        total += entry.size!;
        if (total > 128 * 1024) throw new IntakeError(413, 'Selected context exceeds 128 KiB.');
        const blob = await request(`/repos/${repo.repository}/git/blobs/${entry.sha}`, repo.token, signal);
        if (blob.sha !== entry.sha || blob.encoding !== 'base64' || blob.size !== entry.size) {
          throw new IntakeError(502, 'GitHub returned inconsistent blob metadata.');
        }
        const encoded = text(blob.content, 256 * 1024).replace(/[\r\n]/g, '');
        const bytes = Buffer.from(encoded, 'base64');
        if (bytes.toString('base64') !== encoded || bytes.length !== entry.size ||
            createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== entry.sha) {
          throw new IntakeError(502, 'GitHub blob integrity verification failed.');
        }
        let content;
        try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
        catch { throw new IntakeError(502, 'Selected source is not valid UTF-8.'); }
        context.push({ path, originalBlob: entry.sha, content });
      }
      return context;
    },
    repositories: async (signal: AbortSignal) => {
      await verifyUser(signal);
      const budget = { remaining: 5 };
      const installations = await pages('/user/installations', options.userToken, signal, budget, 'installations');
      let complete = installations.complete;
      const repositories = new Map<number, { id: number; fullName: string; private: boolean }>();
      for (const value of installations.rows) {
        const installation = object(value);
        if (String(id(installation.app_id)) !== options.appId) continue;
        if (installation.suspended_at !== null) {
          if (typeof installation.suspended_at !== 'string') throw new IntakeError(502, 'GitHub returned invalid installation metadata.');
          continue;
        }
        if (!budget.remaining) { complete = false; break; }
        const accessible = await pages(`/user/installations/${id(installation.id)}/repositories`, options.userToken, signal, budget, 'repositories');
        complete = complete && accessible.complete;
        for (const value of accessible.rows) {
          const repository = object(value);
          const fullName = text(repository.full_name, 201);
          if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(fullName) || ['.', '..'].includes(fullName.split('/')[1]) || typeof repository.private !== 'boolean') {
            throw new IntakeError(502, 'GitHub returned invalid repository metadata.');
          }
          const repositoryId = id(repository.id);
          repositories.set(repositoryId, { id: repositoryId, fullName, private: repository.private });
        }
      }
      return { repositories: [...repositories.values()].sort((a, b) => a.fullName.localeCompare(b.fullName)), complete };
    },
    issues: async (repository: string, signal: AbortSignal) => {
      githubRepository(repository);
      const current = await authorize(repository, signal);
      const result = await pages(`/repos/${current.repository}/issues?state=open&sort=updated&direction=desc`, current.token, signal, { remaining: 5 });
      const issues = new Map<number, { id: number; number: number; title: string; updatedAt: string }>();
      for (const value of result.rows) {
        const issue = object(value);
        if ('pull_request' in issue) continue;
        const updatedAt = text(issue.updated_at, 64);
        if (!Number.isFinite(Date.parse(updatedAt))) throw new IntakeError(502, 'GitHub returned invalid issue metadata.');
        const issueId = id(issue.id);
        issues.set(issueId, { id: issueId, number: id(issue.number), title: text(issue.title, 4096), updatedAt });
      }
      return { issues: [...issues.values()], complete: result.complete };
    },
    authorize: async (repository: string, repositoryId: number, signal: AbortSignal) => {
      await authorize(repository, signal, repositoryId);
    },
    issue: async (repository: string, number: number, signal: AbortSignal) => {
      githubRepository(repository);
      if (!Number.isSafeInteger(number) || number < 1) throw new IntakeError(400, 'Select a positive issue number.');
      const repo = await authorize(repository, signal);
      const issue = await request(`/repos/${repo.repository}/issues/${number}`, repo.token, signal);
      if ('pull_request' in issue || id(issue.number) !== number) throw new IntakeError(400, 'Select a GitHub issue rather than a pull request.');
      return { number, title: text(issue.title, 4096), body: issue.body === null ? '' : text(issue.body, 128 * 1024) };
    },
    // Pins the default branch's current commit; the installation token stays inside `download`.
    archive: async (repository: string, signal: AbortSignal): Promise<RepositoryArchive> => {
      githubRepository(repository);
      const repo = await authorize(repository, signal);
      const commit = await request(`/repos/${repo.repository}/commits/${encodeURIComponent(repo.branch)}`, repo.token, signal);
      const sha = text(commit.sha, 64);
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) throw new IntakeError(502, 'GitHub did not return a commit identity.');
      return { repository: repo.repository, branch: repo.branch, sha,
        download: (downloadSignal: AbortSignal) => downloadTarball(options.fetcher ?? fetch, repo.repository, sha, repo.token, downloadSignal),
        publish: await publisher(repo, sha, signal) };
    },
    reviewerVisibility: async (repository: string, repositoryId: number, signal: AbortSignal) =>
      (await authorize(repository, signal, repositoryId)).private,
    snapshot: async (repository: string, number: number, signal: AbortSignal): Promise<IssueSnapshot> => {
      const repo = await authorize(repository, signal);
      const issue = await request(`/repos/${repo.repository}/issues/${number}`, repo.token, signal);
      if ('pull_request' in issue || id(issue.number) !== number) throw new IntakeError(400, 'Select a GitHub issue rather than a pull request.');
      const commit = await request(`/repos/${repo.repository}/commits/${encodeURIComponent(repo.branch)}`, repo.token, signal);
      const baseSha = text(commit.sha, 64);
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseSha)) throw new IntakeError(502, 'GitHub did not return a commit identity.');
      return { repositoryId: repo.repositoryId, repository: repo.repository, private: repo.private,
        issueNumber: number, issueId: id(issue.id), baseSha,
        supplied: { title: text(issue.title, 4096), body: issue.body === null ? '' : text(issue.body, 128 * 1024), provenance: 'supplied' },
        inferred: [], ownerConfirmed: [] };
    }
  };
}

type AccountApi = {
  listUserAccounts(input: { headers: Headers }): Promise<GitHubAccount[]>;
  getAccessToken(input: { headers: Headers; body: { accountId: string } }): Promise<{ accessToken: string }>;
};

export async function linkedGitHubToken(api: AccountApi, headers: Headers, owner: string, signal: AbortSignal) {
  const accounts = await whileActive(() => api.listUserAccounts({ headers }), signal);
  let account;
  try { account = githubAccount(accounts, owner); }
  catch { throw new IntakeError(403, 'Sign in with one linked GitHub account before selecting an issue.'); }
  const token = await whileActive(() => api.getAccessToken({ headers, body: { accountId: account.id } }), signal);
  if (!token.accessToken) throw new IntakeError(403, 'Reconnect GitHub before selecting an issue.');
  return { userToken: token.accessToken, accountId: account.accountId };
}
