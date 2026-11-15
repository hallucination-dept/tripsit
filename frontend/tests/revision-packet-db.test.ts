import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { testDatabaseUrl } from '../src/lib/server/records.ts';
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

test('packet snapshot is atomic against concurrent evidence appends and owner changes', async () => {
 const pool = new pg.Pool({ connectionString: testDatabaseUrl(process.env.TRIPSIT_TEST_DATABASE_URL), connectionTimeoutMillis: 5000 });
 const client = await pool.connect();
 try {
  for (const name of ['001_work_items.sql', '002_candidates.sql', '003_candidate_staging.sql', '004_revision_packets.sql']) await client.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  const payload = { baseSha: base, outputDigest, files: [{ path: 'new.txt', originalBlob: null, blobSha, content: content.toString('base64') }], reviews: [] };
  await client.query('INSERT INTO tripsit_work_items VALUES ($1,$2,$3,$4,$5,$6)', [itemId,'owner','digest','intake',item.createdAt,item.expiresAt]);
  await client.query('INSERT INTO tripsit_snapshots VALUES ($1,$2)', [itemId,JSON.stringify(snapshot)]);
  await client.query('INSERT INTO tripsit_candidates VALUES ($1,$2,$3,$4,$5)', [candidateId,'owner',outputDigest,item.createdAt,item.expiresAt]);
  await client.query('INSERT INTO tripsit_candidate_payloads VALUES ($1,$2,$3)', [candidateId,itemId,JSON.stringify(payload)]);
  await client.query('INSERT INTO tripsit_candidate_stages VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [candidateId,'owner',base,outputDigest,staged.commitSha,staged.rootSha,JSON.stringify(staged.objects),item.expiresAt]);
  const intake = { async get() { return item; } }, generation = { async get() { return { id: candidateId, candidate }; } };
  const github = { async reviewerVisibility() { return false; }, async stagingTree() { return tree; } };
  const reader = { async load() { return structuredClone(assessment); } };
  const service = createRevisionPacket({ database: pool, intake, generation, github, assessment: reader });
  const signal = new AbortController().signal;
  const result = await service.freeze('owner', itemId, candidateId, signal);
  assert.equal(result.packet.candidateCommit, staged.commitSha); assert.equal(result.packet.acceptanceReady, false);
  assert.deepEqual(await service.freeze('owner', itemId, candidateId, signal), result);
  assert.deepEqual(await service.get('owner', itemId, candidateId, String(result.id), signal), { ...result, historical: true });
  await assert.rejects(service.get('other', itemId, candidateId, String(result.id), signal));
  await assert.rejects(service.freeze('other', itemId, candidateId, signal));
  await client.query('DELETE FROM tripsit_revision_packets WHERE candidate_id=$1', [candidateId]);
  let release!: () => void;
  const wait = new Promise<void>(resolve => release = resolve);
  let loaded!: () => void;
  const ready = new Promise<void>(resolve => loaded = resolve);
  const delayed = createRevisionPacket({ database: pool, intake, generation, github, assessment: { async load() { loaded(); await wait; return structuredClone(assessment); } } });
  const pending = delayed.freeze('owner', itemId, candidateId, signal);
  await ready;
  await client.query("UPDATE tripsit_candidate_payloads SET payload=jsonb_set(payload,'{reviews}','[{}]'::jsonb) WHERE candidate_id=$1", [candidateId]);
  release();
  await assert.rejects(pending, { status: 409 });
  assert.equal((await client.query('SELECT count(*)::int AS count FROM tripsit_revision_packets')).rows[0].count, 0);
 } finally { client.release(); await pool.end(); }
});
