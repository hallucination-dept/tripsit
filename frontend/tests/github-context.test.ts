import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createGitHub } from '../src/lib/server/github.ts';
import { IntakeError, type IssueSnapshot } from '../src/lib/server/intake.ts';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const signal = () => new AbortController().signal;
const snapshot: IssueSnapshot = { repositoryId: 5, repository: 'team/repo', private: false,
  issueNumber: 2, issueId: 20, baseSha: 'a'.repeat(40), supplied: { title: '', body: '', provenance: 'supplied' }, inferred: [], ownerConfirmed: [] };
const repository = { id: 5, full_name: 'team/repo', private: false, default_branch: 'changed-branch' };
const bytes = Buffer.from('export const greeting = "こんにちは";\r\n');
const blobSha = (value: Buffer) => createHash('sha1').update(`blob ${value.length}\0`).update(value).digest('hex');
const sha = blobSha(bytes);
const entry = { path: 'src/main.ts', mode: '100644', type: 'blob', sha, size: bytes.length };
const treePath = `/repos/team/repo/git/trees/${snapshot.baseSha}?recursive=1`;
const blobPath = `/repos/team/repo/git/blobs/${sha}`;
const tree = { sha: 'b'.repeat(40), truncated: false, tree: [{ path: 'src', mode: '040000', type: 'tree', sha: 'c'.repeat(40) }, entry] };
const blob = { sha, encoding: 'base64', size: bytes.length, content: bytes.toString('base64') + '\n' };
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: { path: string; token: string }[] = [];
  const values: Record<string, unknown> = { '/user': { id: 42 }, '/repos/team/repo': repository,
    '/repos/team/repo/installation': { id: 7, app_id: 9, suspended_at: null },
    '/app/installations/7/access_tokens': { token: 'installation-token' }, [treePath]: tree, [blobPath]: blob, ...overrides };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(init?.redirect, 'error');
    assert(init?.signal);
    const path = url.pathname + url.search;
    calls.push({ path, token: new Headers(init?.headers).get('Authorization') ?? '' });
    if (init?.body) assert.deepEqual(JSON.parse(String(init.body)), { repository_ids: [5], permissions: { contents: 'read', issues: 'read' } });
    const value = values[path];
    return value instanceof Response ? value : new Response(JSON.stringify(value), { status: value === undefined ? 404 : 200 });
  };
  return { calls, github: createGitHub({ appId: '9', privateKey, accountId: '42', userToken: 'user-token', fetcher }) };
}

test('files and context reauthorize public identity and read only exact frozen tree/blob identities', async () => {
  const { github, calls } = fixture();
  assert.deepEqual(await github.files(snapshot, signal()), [{ path: entry.path, blobSha: sha }]);
  assert.deepEqual(await github.context(snapshot, [entry.path, 'src/new.ts'], signal()), [
    { path: entry.path, originalBlob: sha, content: bytes.toString('utf8') },
    { path: 'src/new.ts', originalBlob: null, content: '' }
  ]);
  assert.equal(calls.filter(call => call.path === '/user').length, 2);
  assert.equal(calls.filter(call => call.path === treePath).length, 2);
  assert(calls.filter(call => call.path.includes('/git/')).every(call => call.token === 'Bearer installation-token'));
  assert(!calls.some(call => call.path.includes('/commits/') || call.path.includes('changed-branch')));
});

test('changed repository IDs and linked/App identities deny source', async () => {
  for (const overrides of [{ '/user': { id: 99 } }, { '/repos/team/repo': { ...repository, id: 6 } },
    { '/repos/team/repo/installation': { id: 7, app_id: 10, suspended_at: null } }]) {
    const { github, calls } = fixture(overrides);
    await assert.rejects(() => github.context(snapshot, [entry.path], signal()), IntakeError);
    assert(!calls.some(call => call.path.includes('/git/')));
  }
  const { github, calls } = fixture();
  await assert.rejects(() => github.files({ ...snapshot, private: 'invalid' as any }, signal()), IntakeError);
  assert.equal(calls.length, 0);
});

test('incomplete, oversized, malformed and duplicate trees cannot certify absent files', async () => {
  for (const value of [{ ...tree, truncated: true }, { tree: tree.tree }, { ...tree, tree: Array(4097).fill(entry) },
    { ...tree, tree: [entry, entry] }, { ...tree, tree: [{ ...entry, path: '../escape' }] },
    { ...tree, tree: [{ ...entry, path: 'src' }, entry] }]) {
    await assert.rejects(() => fixture({ [treePath]: value }).github.context(snapshot, ['new.ts'], signal()), IntakeError);
  }
});

test('only regular blobs can be read and new paths cannot collide with tree entries or selected parents', async () => {
  const special = [{ path: 'link', mode: '120000', type: 'blob', sha }, { path: 'module', mode: '160000', type: 'commit', sha },
    { path: 'run.sh', mode: '100755', type: 'blob', sha, size: bytes.length }];
  const value = { ...tree, tree: [...tree.tree, ...special] };
  assert.deepEqual((await fixture({ [treePath]: value }).github.files(snapshot, signal())).map(row => row.path), ['src/main.ts', 'run.sh']);
  for (const paths of [['link'], ['link/new'], ['module/file'], ['src'], ['src/main.ts/child'], ['new', 'new/child']]) {
    await assert.rejects(() => fixture({ [treePath]: value }).github.context(snapshot, paths, signal()), IntakeError);
  }
});

test('unsafe paths, duplicates, excessive selection and invalid base revision fail before network calls', async () => {
  for (const paths of [['../escape'], ['/absolute'], ['a\\b'], ['a//b'], ['a/./b'], ['a\0b'], ['.git/config'],
    ['a', 'a'], Array.from({ length: 9 }, (_, index) => `file${index}`)]) {
    const { github, calls } = fixture();
    await assert.rejects(() => github.context(snapshot, paths, signal()), IntakeError);
    assert.equal(calls.length, 0);
  }
  const { github, calls } = fixture();
  await assert.rejects(() => github.files({ ...snapshot, baseSha: 'main' }, signal()), IntakeError);
  await assert.rejects(() => github.files(snapshot, AbortSignal.abort()), IntakeError);
  assert.equal(calls.length, 0);
});

test('blob size, canonical base64, identity, raw byte hash and strict UTF8 are verified', async () => {
  for (const value of [{ ...blob, sha: 'd'.repeat(40) }, { ...blob, encoding: 'utf-8' }, { ...blob, size: bytes.length + 1 },
    { ...blob, content: bytes.toString('base64') + '!' }, { ...blob, content: Buffer.alloc(bytes.length, 65).toString('base64') }]) {
    await assert.rejects(() => fixture({ [blobPath]: value }).github.context(snapshot, [entry.path], signal()), IntakeError);
  }
  const invalid = Buffer.from([0xff]);
  const invalidSha = blobSha(invalid);
  await assert.rejects(() => fixture({ [treePath]: { ...tree, tree: [tree.tree[0], { ...entry, sha: invalidSha, size: 1 }] },
    [`/repos/team/repo/git/blobs/${invalidSha}`]: { sha: invalidSha, encoding: 'base64', size: 1, content: invalid.toString('base64') }
  }).github.context(snapshot, [entry.path], signal()), IntakeError);
  await assert.rejects(() => fixture({ [treePath]: { ...tree, tree: [tree.tree[0], { ...entry, size: 128 * 1024 + 1 }] } })
    .github.context(snapshot, [entry.path], signal()), IntakeError);
});


test('aggregate context budget allows exactly 128 KiB and denies additional decoded bytes', async () => {
  const full = Buffer.alloc(128 * 1024, 65);
  const fullSha = blobSha(full);
  const rootEntry = { ...entry, path: 'full.txt', sha: fullSha, size: full.length };
  const values = { [treePath]: { ...tree, tree: [rootEntry, { ...entry, path: 'extra.txt' }] },
    [`/repos/team/repo/git/blobs/${fullSha}`]: { sha: fullSha, encoding: 'base64', size: full.length, content: full.toString('base64') } };
  const { github, calls } = fixture(values);
  assert.equal((await github.context(snapshot, ['full.txt'], signal()))[0].content.length, full.length);
  await assert.rejects(() => github.context(snapshot, ['full.txt', 'extra.txt'], signal()), (error: IntakeError) => error.status === 413);
  assert(!calls.some(call => call.path === blobPath), 'Over-budget blob must not be fetched');
});

test('UTF8 BOM is preserved and aborting a streaming tree read prevents blob retrieval', async () => {
  const bom = Buffer.from('\ufeffsource');
  const bomSha = blobSha(bom);
  assert.equal((await fixture({ [treePath]: { ...tree, tree: [{ ...entry, path: 'bom.txt', sha: bomSha, size: bom.length }] },
    [`/repos/team/repo/git/blobs/${bomSha}`]: { sha: bomSha, encoding: 'base64', size: bom.length, content: bom.toString('base64') }
  }).github.context(snapshot, ['bom.txt'], signal()))[0].content, '\ufeffsource');
  const controller = new AbortController();
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(stream) { stream.enqueue(new TextEncoder().encode('{')); },
    pull() { setTimeout(() => controller.abort(), 10); },
    cancel() { cancelled = true; }
  }));
  const { github, calls } = fixture({ [treePath]: response });
  await assert.rejects(() => github.context(snapshot, [entry.path], controller.signal), IntakeError);
  assert(cancelled);
  assert(!calls.some(call => call.path === blobPath));
});


test('authorized private snapshots read only their frozen blobs using the same repository access checks', async () => {
 const { github, calls } = fixture({ '/repos/team/repo': { ...repository, private: true } });
 const privateSnapshot = { ...snapshot, private: true };
 assert.deepEqual(await github.files(privateSnapshot, signal()), [{ path: entry.path, blobSha: sha }]);
 assert.deepEqual(await github.context(privateSnapshot, [entry.path], signal()), [{ path: entry.path, originalBlob: sha, content: bytes.toString('utf8') }]);
 assert.equal(calls.filter(call => call.path === '/user').length, 2);
 assert(calls.filter(call => call.path.includes('/git/')).every(call => call.token === 'Bearer installation-token'));
});
