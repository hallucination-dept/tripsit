import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Pool } from 'pg';
import { createRecords, testDatabaseUrl } from '../src/lib/server/records.ts';
import { createCandidateRecords } from '../src/lib/server/candidate-records.ts';
import { generationSettingsDigest, mapCandidateTokenBytes } from '../src/lib/server/candidate-output.ts';

test('disposable PostgreSQL retains exact candidate bytes and cascades expired source references', async () => {
  const connectionString = testDatabaseUrl(process.env.TRIPSIT_TEST_DATABASE_URL);
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000 });
  const schema = `candidate_test_${randomBytes(12).toString('hex')}`;
  let schemaCreated = false;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${schema}`);
      await client.query(await readFile(new URL('../migrations/001_work_items.sql', import.meta.url), 'utf8'));
      const beforeMigration = createCandidateRecords(client);
      await assert.rejects(() => beforeMigration.ready(), error => error.status === 503 && /002_candidates\.sql/.test(error.message));
      await client.query(await readFile(new URL('../migrations/002_candidates.sql', import.meta.url), 'utf8'));
      let now = new Date('2026-01-01T00:00:00Z');
      const records = createRecords(client, () => now);
      const store = createCandidateRecords(client, () => now);
      await store.ready();
      const snapshot = { repositoryId: 1, repository: 'fixture/source-reference', private: false,
        issueNumber: 1, issueId: 1, baseSha: 'a'.repeat(40), supplied: {
          title: 'Fixture', body: 'original raw source', provenance: 'supplied' as const }, inferred: [], ownerConfirmed: [] };
      const item = await records.create('owner-a', snapshot);
      const otherItem = await records.create('owner-a', snapshot);
      const content = new TextEncoder().encode('const snow = "雪";\r\n');
      const rawOutput = new Uint8Array([239, 187, 191, 0, 255, 13, 10, 226, 152, 131]);
      const candidate = { baseSha: snapshot.baseSha, expiresAt: item.expiresAt,
        rawOutput, outputDigest: createHash('sha256').update(rawOutput).digest('hex'), model: 'fixture-model', settings: { temperature: 0 },
        files: [{ path: "雪'); DROP TABLE data;--.ts", originalBlob: null, content,
          blobSha: createHash('sha1').update(`blob ${content.byteLength}\0`).update(content).digest('hex') }],
        mapping: { status: 'unavailable' as const, reason: 'Exact mapping unavailable.' } };
      const created = await store.create('owner-a', item.id, candidate);
      assert.deepEqual(created.candidate, candidate);
      assert.deepEqual(await store.get('owner-a', item.id, created.id), created);
      const exactRaw = new TextEncoder().encode(JSON.stringify({ files: [{ path: 'snow.ts', originalBlob: null, content: new TextDecoder().decode(content) }] }));
      const observations = { status: 'observed' as const, tokens: [{ token: 'fixture', bytes: Array.from(exactRaw), logprob: -1 }] };
      const settings = { z: 1, a: true };
      const mapped = mapCandidateTokenBytes(exactRaw, new Map([['snow.ts', null]]), observations.tokens, candidate.model, generationSettingsDigest(settings));
      assert.equal(mapped.status, 'exact'); if (mapped.status !== 'exact') throw Error('fixture mapping unavailable');
      const exact = { ...candidate, rawOutput: exactRaw, outputDigest: createHash('sha256').update(exactRaw).digest('hex'),
        settings, observations, files: [{ ...candidate.files[0], path: 'snow.ts' }],
        tokenByteMapping: { ...mapped, mode: 'direct' as const, observationsDigest: createHash('sha256').update(JSON.stringify(observations)).digest('hex') } };
      const exactCreated = await store.create('owner-a', item.id, exact);
      assert.deepEqual((await store.get('owner-a', item.id, exactCreated.id))?.candidate.tokenByteMapping, exact.tokenByteMapping);
      await client.query(`UPDATE tripsit_candidate_payloads SET payload = jsonb_set(payload, '{tokenByteMapping,files,0,segments,0,fileEnd}', '999') WHERE candidate_id = $1`, [exactCreated.id]);
      await assert.rejects(() => store.get('owner-a', item.id, exactCreated.id), { status: 503 });
      await client.query('DELETE FROM tripsit_candidates WHERE id = $1', [exactCreated.id]);
      assert.equal(await store.get('owner-b', item.id, created.id), null);
      assert.equal(await store.get('owner-a', otherItem.id, created.id), null);
      for (const [owner, selected, changed] of [
        ['owner-b', item.id, candidate],
        ['owner-a', item.id, { ...candidate, baseSha: 'b'.repeat(40) }],
        ['owner-a', item.id, { ...candidate, expiresAt: '2026-01-07T00:00:00.000Z' }]
      ] as const) await assert.rejects(() => store.create(owner, selected, changed), error => error.status === 404);
      const privateItem = await records.create('owner-a', { ...snapshot, private: true });
      const privateCandidate = await store.create('owner-a', privateItem.id, candidate);
      assert.deepEqual(await store.get('owner-a', privateItem.id, privateCandidate.id), privateCandidate);
      assert.equal(await store.get('owner-b', privateItem.id, privateCandidate.id), null);
      assert.equal((await client.query('SELECT count(*)::int AS count FROM tripsit_candidates')).rows[0].count, 2);
      now = new Date(item.expiresAt);
      assert.equal(await store.get('owner-a', item.id, created.id), null);
      await assert.rejects(() => store.create('owner-a', item.id, candidate), error => error.status === 404);
      await records.purge();
      assert.equal((await client.query('SELECT count(*)::int AS count FROM tripsit_candidate_payloads')).rows[0].count, 0);
      assert.equal((await client.query('SELECT count(*)::int AS count FROM tripsit_snapshots')).rows[0].count, 0);
      const metadata = await client.query('SELECT * FROM tripsit_candidates');
      assert.equal(metadata.rowCount, 2);
      assert.equal(metadata.rows[0].output_digest, candidate.outputDigest);
      assert.deepEqual(Object.keys(metadata.rows[0]).sort(), ['id', 'owner_id', 'output_digest', 'created_at', 'expires_at'].sort());
      for (const source of [snapshot.repository, snapshot.supplied.body, candidate.model, candidate.files[0].path]) {
        assert(!JSON.stringify(metadata.rows).includes(source));
      }
    } finally { client.release(); }
  } finally {
    try { if (schemaCreated) await pool.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await pool.end(); }
  }
});

test('candidate database harness refuses missing, production and nonlocal targets', () => {
  for (const value of [undefined, 'postgres://localhost/production', 'postgres://remote.example/tripsit_e01s01_test']) {
    assert.throws(() => testDatabaseUrl(value));
  }
});
