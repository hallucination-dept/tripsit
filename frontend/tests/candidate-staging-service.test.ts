import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createStaging } from '../src/lib/server/staging-service.ts';
import { IntakeError } from '../src/lib/server/intake.ts';

const content = Buffer.from('hello\n'), blobSha = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
const item = () => ({ id: 'item', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', snapshot: { repositoryId: 1, repository: 'a/b', private: false, issueNumber: 1, issueId: 2, baseSha: 'a'.repeat(40), supplied: { title: '', body: '', provenance: 'supplied' as const }, inferred: [], ownerConfirmed: [] } });
const candidate = () => ({ id: 'candidate', candidate: { baseSha: 'a'.repeat(40), outputDigest: 'b'.repeat(64), files: [{ path: 'new.txt', originalBlob: null, blobSha, content }] } });
function fixture() {
 const state = item(); let queries = 0;
 const intake = { async get(owner: string) { if (owner !== 'owner') throw new IntakeError(404, 'missing'); return structuredClone(state); } };
 const generation = { async get() { return candidate() as never; } };
 const github = { async stagingTree() { return { baseSha: state.snapshot.baseSha, treeSha: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', entries: [] }; } };
 const database = { async query(sql: string, values?: unknown[]) { queries++; assert.match(sql, /FOR SHARE OF c,p,w,s/); assert.equal(values![0], 'owner'); return { rows: [{ commit_sha: values![5] }] }; } };
 return { state, intake, generation, github, database, queries: () => queries, service: createStaging({ intake, generation, github, database }) };
}
test('stages owner candidate with a locked snapshot and stable identity', async () => {
 const f = fixture(); const signal = new AbortController().signal;
 const first = await f.service.stage('owner', 'item', 'candidate', signal);
 assert.equal(first.candidateDigest, 'b'.repeat(64)); assert.match(first.candidateCommit, /^[a-f0-9]{40}$/);
 assert.deepEqual(await f.service.stage('owner', 'item', 'candidate', signal), first);
 assert.equal(f.queries(), 2);
});
test('cross-owner, private and stale revisions never persist', async () => {
 for (const mode of ['other', 'private', 'stale']) {
  const f = fixture();
  if (mode === 'private') f.state.snapshot.private = true;
  if (mode === 'stale') f.github.stagingTree = async () => { f.state.snapshot.baseSha = 'c'.repeat(40); return { baseSha: 'a'.repeat(40), treeSha: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', entries: [] }; };
  await assert.rejects(f.service.stage(mode === 'other' ? 'other' : 'owner', 'item', 'candidate', new AbortController().signal));
  assert.equal(f.queries(), 0);
 }
});
