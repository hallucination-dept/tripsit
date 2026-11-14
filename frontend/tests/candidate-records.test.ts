import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createCandidateRecords } from '../src/lib/server/candidate-records.ts';

const owner = "owner'); DROP TABLE tripsit_candidates;--";
const itemId = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-01-01T00:00:00Z');
const content = new TextEncoder().encode('const snow = "雪";\r\n');
const rawOutput = new Uint8Array([0, 255, 13, 10, 239, 187, 191]);
const candidate = () => ({ baseSha: 'a'.repeat(40), expiresAt: '2026-01-08T00:00:00.000Z',
  rawOutput, outputDigest: createHash('sha256').update(rawOutput).digest('hex'), model: 'fixture', settings: { temperature: 0, flag: true, optional: null },
  files: [{ path: '雪.ts', originalBlob: null, content,
    blobSha: createHash('sha1').update(`blob ${content.byteLength}\0`).update(content).digest('hex') }],
  mapping: { status: 'unavailable' as const, reason: 'No exact token mapping.' } });

test('candidate storage binds owners and snapshots, serializes exact bytes and checks readiness', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  let payload: unknown;
  const database = { async query(sql: string, values: unknown[] = []) {
    calls.push({ sql, values });
    if (sql.includes('to_regclass')) return { rows: [{ ready: true }] };
    if (sql.includes('INSERT INTO')) {
      payload = values.find(value => typeof value === 'string' && value.startsWith('{'));
      return { rows: [{ id }] };
    }
    return { rows: [{ id, payload: JSON.parse(payload as string) }] };
  } };
  const store = createCandidateRecords(database, () => now);
  await store.ready();
  const created = await store.create(owner, itemId, candidate());
  assert.equal(created.id, id);
  assert.deepEqual(created.candidate, candidate());
  const insertion = calls[1];
  assert(!insertion.sql.includes(owner));
  assert(insertion.values.includes(owner));
  assert(insertion.values.includes(itemId));
  assert(insertion.values.includes(candidate().baseSha));
  assert(insertion.values.includes(candidate().expiresAt));
  assert(!String(payload).includes('"0":'));
  const retained = await store.get(owner, itemId, id);
  assert.deepEqual(retained, created);
  assert.deepEqual(calls[2].values.slice(0, 3), [owner, itemId, id]);
});

test('missing migration, database failures and malformed persisted bytes fail with safe errors', async () => {
  const failure = (status: number, hint?: RegExp) => (error: { status?: number; message?: string }) =>
    error.status === status && !error.message?.includes('password') && (!hint || hint.test(error.message ?? ''));
  const missing = createCandidateRecords({ async query() { return { rows: [{ ready: false }] }; } }, () => now);
  await assert.rejects(() => missing.ready(), failure(503, /002_candidates\.sql/));
  const broken = createCandidateRecords({ async query() { throw new Error('password=secret'); } }, () => now);
  await assert.rejects(() => broken.ready(), failure(503));
  await assert.rejects(() => broken.create(owner, itemId, candidate()), failure(503));
  await assert.rejects(() => broken.get(owner, itemId, id), failure(503));
  const absent = createCandidateRecords({ async query() { return { rows: [] }; } }, () => now);
  await assert.rejects(() => absent.create(owner, itemId, candidate()), failure(404));
  assert.equal(await absent.get(owner, itemId, id), null);
  await assert.rejects(() => absent.create('', itemId, candidate()), failure(401));
  const malformed = createCandidateRecords({ async query() { return { rows: [{ id, payload: { ...candidate(), rawOutput: '%%%bad-base64' } }] }; } }, () => now);
  await assert.rejects(() => malformed.get(owner, itemId, id), failure(503));
  await assert.rejects(() => absent.create(owner, itemId, { ...candidate(), outputDigest: 'f'.repeat(64) }), failure(400));
  await assert.rejects(() => absent.create(owner, itemId, { ...candidate(), expiresAt: now.toISOString() }), failure(404));
});
