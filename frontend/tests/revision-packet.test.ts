import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createRevisionPacket } from '../src/lib/server/revision-packet.ts';
import { stageCandidate } from '../src/lib/server/candidate-staging.ts';
import { analyzeImpact, type ImpactGraph } from '../src/lib/server/impact.ts';
import { baselinePolicy } from '../src/lib/server/policy.ts';
import type { GeneratedCandidate } from '../src/lib/server/generation.ts';

const itemId = '11111111-1111-4111-8111-111111111111', candidateId = '22222222-2222-4222-8222-222222222222';
const base = 'a'.repeat(40), outputDigest = 'b'.repeat(64), content = Buffer.from('hello\n');
const blobSha = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
const snapshot = { repositoryId: 1, repository: 'a/b', private: false, issueNumber: 1, issueId: 2, baseSha: base, supplied: { title: '', body: '', provenance: 'supplied' as const }, inferred: [], ownerConfirmed: [] };
const item = { id: itemId, snapshot, createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' };
const tree = { baseSha: base, treeSha: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', entries: [] };
const candidate = { baseSha: base, outputDigest, files: [{ path: 'new.txt', originalBlob: null, blobSha, content }] } as GeneratedCandidate;
const staged = stageCandidate(base, tree.treeSha, tree.entries, candidate, item.createdAt);
const policy = baselinePolicy('unknown');
const identity = { ownerId: 'owner', itemId, candidateId, baseSha: base, candidateDigest: outputDigest, snapshotDigest: 'c'.repeat(64), policyVersion: policy.version };
const graph: ImpactGraph = { revision: { baseSha: base, headSha: null, candidateDigest: outputDigest }, nodes: [], edges: [], changed: ['missing'] };
const assessment = { identity, repositoryId: 1, generation: { model: 'gemma', settingsDigest: 'd'.repeat(64), mapping: { status: 'unavailable' as const, reason: 'No exact mapping.' }, observedTokens: 0 }, policy,
 impact: { graph, impact: analyzeImpact(graph), imports: [], gaps: [], coverage: { extraction: 'js_ts_static_file_imports', semanticResolution: 'not_performed', executableChecks: 'not_run', complete: false, typescriptVersion: '6.0.3' } }, reviews: [], files: [] };
function fixture() {
 let inserts = 0;
 const row = { payload: { files: [] }, snapshot, commit_sha: staged.commitSha, base_sha: base, output_digest: outputDigest, tree_sha: staged.rootSha, objects: staged.objects };
 const database = { async query(sql: string, values?: unknown[]) { if (sql.startsWith('SELECT')) return { rows: [row] }; inserts++; assert.match(sql, /FOR UPDATE OF p/); return { rows: [{ id: 'packet-id', packet_digest: values![10] }] }; } };
 const deps = { database, intake: { async get() { return item; } }, generation: { async get() { return { id: candidateId, candidate }; } },
  github: { async reviewerVisibility() { return false; }, async stagingTree() { return tree; } }, assessment: { async load() { return structuredClone(assessment); } } };
 return { row, deps, inserts: () => inserts, service: createRevisionPacket(deps) };
}
test('freezes an owner packet against the exact reconstructed commit without granting acceptance', async () => {
 const f = fixture(), value = await f.service.freeze('owner', itemId, candidateId, new AbortController().signal);
 assert.equal(value.packet.candidateCommit, staged.commitSha); assert.equal(value.packet.acceptanceReady, false);
 assert.equal(value.packetDigest, createHash('sha256').update(JSON.stringify(value.packet)).digest('hex'));
 assert.equal(f.inserts(), 1);
});
test('refuses mismatched staged objects, owner, and private repository before persistence', async () => {
 for (const mode of ['object', 'owner', 'private']) {
  const f = fixture();
  if (mode === 'object') f.row.commit_sha = 'f'.repeat(40);
  if (mode === 'private') f.deps.github.reviewerVisibility = async () => true;
  await assert.rejects(f.service.freeze(mode === 'owner' ? 'other' : 'owner', itemId, candidateId, new AbortController().signal));
  assert.equal(f.inserts(), 0);
 }
});
