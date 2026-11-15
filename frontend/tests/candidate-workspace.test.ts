import assert from 'node:assert/strict';
import test from 'node:test';
import { createCandidateWorkspace } from '../src/lib/candidate-workspace.ts';

const item = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const sha = 'a'.repeat(40);
const policy = { version: 'baseline-1', assessment: 'unverified', requirements: [], gaps: [{ id: 'performance', reason: 'Workload missing.' }] };
const files = [{ path: 'a.ts', blobSha: 'b'.repeat(40) }];
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const candidate = () => ({ id: other, candidate: { baseSha: sha, expiresAt: new Date(Date.now() + 60000).toISOString(),
  outputDigest: 'c'.repeat(64), model: 'fixture', settings: {}, mapping: { status: 'unavailable', reason: 'No mapping.' },
  observations: { status: 'unavailable', count: 0 }, files: [{ ...files[0], originalBlob: files[0].blobSha, content: '雪\r\n' }] } });
const payload = (url: string, id = item) => url.endsWith('/policy')
  ? { itemId: id, baseSha: sha, snapshotDigest: 'd'.repeat(64), policy }
  : { itemId: id, baseSha: sha, files };

test('loads policy and files independently and generates only explicit validated selections', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const workspace = createCandidateWorkspace({ fetcher: async (url, init) => {
    requests.push({ url: String(url), init });
    if (init?.method === 'POST') return response(candidate());
    return response(payload(String(url)));
  } });
  await workspace.select('owner', item, sha);
  assert.equal(requests.length, 2);
  assert.deepEqual(workspace.state.files, files);
  assert.deepEqual(workspace.state.policy, policy);
  assert.equal(workspace.state.candidate, null);
  assert.equal(workspace.state.loading, false);
  for (const paths of [[], ['missing'], ['a.ts', 'a.ts'], Array(9).fill('a.ts')]) await workspace.generate(paths);
  assert.equal(requests.length, 2);
  assert(workspace.state.generationError);
  await workspace.generate(['a.ts']);
  assert.equal(requests[2].url, `/api/work-items/${item}/candidates`);
  assert.deepEqual(JSON.parse(String(requests[2].init?.body)), { paths: ['a.ts'] });
  assert.equal(requests[2].init?.credentials, 'same-origin');
  assert.equal(new Headers(requests[2].init?.headers).get('Content-Type'), 'application/json');
  assert.equal(workspace.state.candidate?.id, other);
  assert.equal(workspace.state.generating, false);
  assert.equal(workspace.state.generationError, '');
  workspace.stop();
  assert.equal(workspace.state.owner, '');
  assert.equal(workspace.state.candidate, null);
});

test('policy/files failures stay independent and reject mismatched response identities', async () => {
  for (const failed of ['policy', 'files']) {
    const workspace = createCandidateWorkspace({ fetcher: async url => String(url).endsWith(`/${failed}`)
      ? response({ message: `${failed} unavailable` }, 503) : response(payload(String(url))) });
    await workspace.select('owner', item, sha);
    assert.equal(workspace.state[`${failed}Error`], `${failed} unavailable`);
    assert(failed === 'policy' ? workspace.state.files.length === 1 : workspace.state.policy !== null);
    assert.equal(workspace.state.loading, false);
  }
  const mismatched = createCandidateWorkspace({ fetcher: async url => response(payload(String(url), other)) });
  await mismatched.select('owner', item, sha);
  assert.equal(mismatched.state.policy, null);
  assert.deepEqual(mismatched.state.files, []);
  assert(mismatched.state.policyError && mismatched.state.filesError);
});

test('owner/item selection changes discard transport that ignores abort, including old generation', async () => {
  const pending: Array<{ url: string; signal: AbortSignal; resolve: (value: Response) => void }> = [];
  let slow = true;
  const workspace = createCandidateWorkspace({ fetcher: async (url, init) => {
    if (slow || init?.method === 'POST') return new Promise<Response>(resolve => pending.push({ url: String(url), signal: init!.signal as AbortSignal, resolve }));
    return response(payload(String(url), other));
  } });
  const first = workspace.select('owner-a', item, sha);
  assert.equal(pending.length, 2);
  slow = false;
  await workspace.select('owner-b', other, sha);
  assert(pending.every(request => request.signal.aborted));
  for (const request of pending.splice(0)) request.resolve(response(payload(request.url)));
  await first;
  assert.equal(workspace.state.owner, 'owner-b');
  assert.equal(workspace.state.itemId, other);
  const generating = workspace.generate(['a.ts']);
  assert.equal(pending.length, 1);
  await workspace.select('owner-b', item, sha);
  assert(pending[0].signal.aborted);
  pending[0].resolve(response(candidate()));
  await generating;
  assert.equal(workspace.state.candidate, null);
  assert.equal(workspace.state.generating, false);
  workspace.stop();
});

test('generation failures clean up and expose only bounded public server messages', async () => {
  let mode = 'server';
  const workspace = createCandidateWorkspace({ fetcher: async (url, init) => {
    if (init?.method !== 'POST') return response(payload(String(url)));
    if (mode === 'network') throw new Error('secret upstream stack');
    if (mode === 'server') return response({ message: 'Candidate unavailable.' }, 503);
    return response({ ...candidate(), candidate: { ...candidate().candidate, baseSha: 'f'.repeat(40) } });
  } });
  await workspace.select('owner', item, sha);
  for (mode of ['server', 'network', 'mismatched']) {
    await workspace.generate(['a.ts']);
    assert.equal(workspace.state.generating, false);
    assert.equal(workspace.state.candidate, null);
    assert(!workspace.state.generationError.includes('secret'));
    assert(workspace.state.generationError);
  }
});

test('empty selections and stop clear immediately without network or late state updates', async () => {
  let calls = 0;
  const workspace = createCandidateWorkspace({ fetcher: async () => { calls++; return new Promise<Response>(() => {}); } });
  await workspace.select('', item, sha);
  await workspace.select('owner', '', sha);
  assert.equal(calls, 0);
  const selecting = workspace.select('owner', item, sha);
  assert.equal(workspace.state.loading, true);
  workspace.stop();
  await selecting;
  assert.equal(workspace.state.loading, false);
  assert.equal(workspace.state.itemId, '');
  assert.equal(workspace.state.policy, null);
  assert.deepEqual(workspace.state.files, []);
});

test('agent implementation starts without a human file selection and sends only the frozen item identity', async () => {
 let body:unknown;let posts=0;
 const workspace=createCandidateWorkspace({fetcher:async(url,init)=>{
  if(init?.method==='POST'){posts++;body=JSON.parse(String(init.body));return response(candidate());}
  return response(payload(String(url)));
 }});
 await workspace.select('owner',item,sha);await workspace.generate();
 assert.deepEqual(body,{});assert.equal(posts,1);assert.equal(workspace.state.candidate?.id,other);assert.equal(workspace.state.generationError,'');
});
