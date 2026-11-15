import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createCandidateRecords } from '../src/lib/server/candidate-records.ts';
import { mapCandidateTokenBytes } from '../src/lib/server/candidate-output.ts';

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

test('exact mappings round trip and reject changed source, observation, settings or span', async () => {
  let payload = '';
  const store = createCandidateRecords({ async query(sql, values = []) {
    if (sql.includes('INSERT INTO')) { payload = values[7] as string; return { rows: [{ id }] }; }
    return { rows: [{ id, payload: JSON.parse(payload) }] };
  } }, () => now);
  const data = new TextEncoder().encode(JSON.stringify({ files: [{ path: '雪.ts', originalBlob: null, content: new TextDecoder().decode(content) }] }));
  const observations = { status: 'observed' as const, tokens: [{ token: 'data', bytes: Array.from(data), logprob: -1 }] };
  const mapping = mapCandidateTokenBytes(data, new Map([['雪.ts', null]]), observations.tokens, 'fixture', createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(candidate().settings).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)))).digest('hex'));
  assert.equal(mapping.status, 'exact'); if (mapping.status !== 'exact') return;
  const value = { ...candidate(), rawOutput: data, outputDigest: createHash('sha256').update(data).digest('hex'), observations, tokenByteMapping: { ...mapping, mode: 'direct' as const, observationsDigest: createHash('sha256').update(JSON.stringify(observations)).digest('hex') } };
  await store.create(owner, itemId, value);
  assert.deepEqual((await store.get(owner, itemId, id))?.candidate.tokenByteMapping, value.tokenByteMapping);
  const intact = payload;
  const reordered = JSON.parse(intact);
  reordered.settings = Object.fromEntries(Object.entries(reordered.settings).reverse());
  reordered.tokenByteMapping = Object.fromEntries(Object.entries(reordered.tokenByteMapping).reverse());
  payload = JSON.stringify(reordered);
  assert.deepEqual((await store.get(owner, itemId, id))?.candidate.tokenByteMapping, value.tokenByteMapping);
  for (const mutate of [
    (record: any) => { record.tokenByteMapping.files[0].segments[0].fileEnd++; },
    (record: any) => { record.observations.tokens[0].bytes[0]++; },
    (record: any) => { record.observations.tokens[0].logprob = -2; },
    (record: any) => { record.settings.temperature = 1; },
    (record: any) => { record.tokenByteMapping.files[0].blobSha = 'b'.repeat(40); }
  ]) {
    const record = JSON.parse(intact); mutate(record); payload = JSON.stringify(record);
    await assert.rejects(() => store.get(owner, itemId, id), { status: 503 });
  }
});

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

test('validated observations retain Unicode, raw token bytes and logprobs within the total payload bound', async () => {
  let payload: string;
  let queries = 0;
  const store = createCandidateRecords({ async query(sql, values = []) {
    queries++;
    if (sql.includes('INSERT INTO')) { payload = values[7] as string; return { rows: [{ id }] }; }
    return { rows: [{ id, payload: JSON.parse(payload) }] };
  } }, () => now);
  const observations = { status: 'observed' as const, tokens: [
    { token: '雪\r\n', bytes: [233, 155, 170, 13, 10], logprob: -0.123456789 },
    { token: 'split byte', bytes: [255, 0, 128], logprob: -99 },
    { token: 'no bytes', bytes: null, logprob: 0 }
  ] };
  const created = await store.create(owner, itemId, { ...candidate(), observations });
  assert.deepEqual(created.candidate.observations, observations);
  assert.deepEqual((await store.get(owner, itemId, id))!.candidate.observations, observations);
  const before = queries;
  await assert.rejects(() => store.create(owner, itemId, { ...candidate(), observations: {
    status: 'observed', tokens: [{ token: 'secret-token-text', bytes: [999], logprob: 1 }]
  } }), error => error.status === 400 && !error.message.includes('secret-token-text'));
  assert.equal(queries, before);
  const tampered = JSON.parse(payload);
  tampered.observations.tokens[0].logprob = 1;
  payload = JSON.stringify(tampered);
  await assert.rejects(() => store.get(owner, itemId, id), error => error.status === 503 && !error.message.includes('雪'));
  const largeBytes = new Uint8Array(1_048_576);
  const oversized = { ...candidate(), rawOutput: largeBytes, outputDigest: createHash('sha256').update(largeBytes).digest('hex'),
    files: [{ ...candidate().files[0], content: largeBytes,
      blobSha: createHash('sha1').update(`blob ${largeBytes.byteLength}\0`).update(largeBytes).digest('hex') }],
    observations: { status: 'observed' as const, tokens: Array.from({ length: 100 }, () => ({ token: 'a'.repeat(16_000), bytes: null, logprob: -1 })) } };
  await assert.rejects(() => store.create(owner, itemId, oversized), error => error.status === 400);
});
