import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Pool } from 'pg';
import { createRecords, testDatabaseUrl } from '../src/lib/server/records.ts';
import { createCandidateRecords } from '../src/lib/server/candidate-records.ts';
import { createReviewRecords } from '../src/lib/server/review-records.ts';
import { snapshotPolicy } from '../src/lib/server/snapshot-policy.ts';

test('real PostgreSQL scopes immutable reviews, caps history and purges all raw review references', async () => {
  const pool = new Pool({ connectionString: testDatabaseUrl(process.env.TRIPSIT_TEST_DATABASE_URL), connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000 });
  const schema = `review_test_${randomBytes(12).toString('hex')}`;
  let createdSchema = false;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`); createdSchema = true;
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${schema}`);
      for (const file of ['001_work_items.sql', '002_candidates.sql']) await client.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
      let now = new Date('2026-01-01T00:00:00Z');
      const records = createRecords(client, () => now);
      const candidates = createCandidateRecords(client, () => now);
      const reviews = createReviewRecords(client, () => now);
      const item = await records.create('owner', { repository: 'test/source', repositoryId: 1, private: false, issueId: 1, issueNumber: 1, baseSha: 'a'.repeat(40), supplied: { title: 'Review fixture', body: '', provenance: 'supplied' }, inferred: [], ownerConfirmed: [] });
      const rawOutput = new TextEncoder().encode('{}');
      const content = new TextEncoder().encode('export const snow = "雪";\r\n');
      const candidate = await candidates.create('owner', item.id, { baseSha: item.snapshot.baseSha, expiresAt: item.expiresAt, rawOutput, outputDigest: createHash('sha256').update(rawOutput).digest('hex'), model: 'fixture', settings: {}, mapping: { status: 'unavailable', reason: 'No mapping.' }, files: [{ path: 'source.ts', originalBlob: null, content, blobSha: createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex') }] });
      const policy = snapshotPolicy(item);
      const identity = { ownerId: 'owner', itemId: item.id, candidateId: candidate.id, baseSha: item.snapshot.baseSha, candidateDigest: candidate.candidate.outputDigest, snapshotDigest: policy.snapshotDigest, policyVersion: policy.policy.version };
      const result = { status: 'unavailable' as const, reason: 'Exact fixture text: 雪\r\n<script>not executed</script>' };
      const first = await reviews.append('owner', identity, result);
      assert.deepEqual(await reviews.list('owner', identity), [first]);
      assert.deepEqual((await reviews.list('owner', { ...identity, policyVersion: 'baseline-next' }))[0].identity, identity);
      assert.deepEqual((await candidates.get('owner', item.id, candidate.id))!.candidate.files[0].content, content);
      await assert.rejects(() => reviews.list('other', { ...identity, ownerId: 'other' }), { status: 404 });
      await assert.rejects(() => reviews.append('other', { ...identity, ownerId: 'other' }, result), { status: 404 });
      await assert.rejects(() => reviews.append('owner', { ...identity, candidateDigest: 'd'.repeat(64) }, result), { status: 404 });
      for (let index = 1; index < 8; index++) await reviews.append('owner', identity, result);
      assert.equal((await reviews.list('owner', identity)).length, 8);
      await assert.rejects(() => reviews.append('owner', identity, result), { status: 404 });
      now = new Date(item.expiresAt);
      await assert.rejects(() => reviews.list('owner', identity), { status: 404 });
      await records.purge();
      assert.equal((await client.query('SELECT count(*)::int AS n FROM tripsit_candidate_payloads')).rows[0].n, 0);
      const metadata = await client.query('SELECT * FROM tripsit_candidates');
      assert.equal(metadata.rowCount, 1);
      assert(!JSON.stringify(metadata.rows).includes('Exact fixture text'));
      assert(!JSON.stringify(metadata.rows).includes(item.id));
    } finally { client.release(); }
  } finally {
    try { if (createdSchema) await pool.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await pool.end(); }
  }
});
