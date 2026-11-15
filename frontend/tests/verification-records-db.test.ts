import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Pool } from 'pg';
import { createRecords, testDatabaseUrl } from '../src/lib/server/records.ts';
import { createCandidateRecords } from '../src/lib/server/candidate-records.ts';
import { createVerificationRecords } from '../src/lib/server/verification-records.ts';
import { snapshotPolicy } from '../src/lib/server/snapshot-policy.ts';

test('real PostgreSQL scopes execution evidence, atomically caps count and bytes and purges raw references', async () => {
  const pool = new Pool({ connectionString: testDatabaseUrl(process.env.TRIPSIT_TEST_DATABASE_URL), connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000 });
  const schema = `verification_test_${randomBytes(12).toString('hex')}`;
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
      const verificationDatabase = { async query(sql: string, values?: unknown[]) {
        const connection = await pool.connect();
        try { await connection.query(`SET search_path TO ${schema}`); return await connection.query(sql, values); }
        finally { connection.release(); }
      } };
      const verifications = createVerificationRecords(verificationDatabase, () => now);
      const item = await records.create('owner', { repository: 'test/source', repositoryId: 1, private: false, issueId: 1, issueNumber: 1, baseSha: 'a'.repeat(40), supplied: { title: 'Review fixture', body: '', provenance: 'supplied' }, inferred: [], ownerConfirmed: [] });
      const rawOutput = new TextEncoder().encode('{}');
      const content = new TextEncoder().encode('export const snow = "雪";\r\n');
      const candidate = await candidates.create('owner', item.id, { baseSha: item.snapshot.baseSha, expiresAt: item.expiresAt, rawOutput, outputDigest: createHash('sha256').update(rawOutput).digest('hex'), model: 'fixture', settings: {}, mapping: { status: 'unavailable', reason: 'No mapping.' }, files: [{ path: 'source.ts', originalBlob: null, content, blobSha: createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex') }] });
      const policy = snapshotPolicy(item);
      const identity = { ownerId: 'owner', itemId: item.id, candidateId: candidate.id, baseSha: item.snapshot.baseSha, candidateDigest: candidate.candidate.outputDigest, snapshotDigest: policy.snapshotDigest, policyVersion: policy.policy.version };
      const hashes = { definitionDigest: 'd'.repeat(64), environmentDigest: 'e'.repeat(64), dependencyDigest: 'f'.repeat(64), oracleDigest: '1'.repeat(64) };
      const result = { checks: [{ id: 'check-1', mandatory: true, impact: 'unknown' as const, timeoutMs: 1000, provenance: 'trusted_repository' as const, requirementIds: ['R1'], nodeIds: ['N1'], ...hashes }],
        executions: [{ id: 'execution-1', checkId: 'check-1', collector: 'trusted_runner' as const, runnerId: 'runner-1', prId: null, status: 'completed' as const, result: 'failed' as const, exitCode: 1, executedTests: 1, ...hashes }],
        admission: { status: 'passed' as const, configurationDigest: '2'.repeat(64), codeDigest: '3'.repeat(64), environmentDigest: hashes.environmentDigest } };
      const first = await verifications.append('owner', identity, result);
      assert.deepEqual(await verifications.list('owner', identity), [first]);
      assert.deepEqual((await verifications.list('owner', { ...identity, policyVersion: 'baseline-next' }))[0].identity, identity);
      assert.deepEqual((await candidates.get('owner', item.id, candidate.id))!.candidate.files[0].content, content);
      await assert.rejects(() => verifications.list('other', { ...identity, ownerId: 'other' }), { status: 404 });
      await assert.rejects(() => verifications.append('other', { ...identity, ownerId: 'other' }, result), { status: 404 });
      await assert.rejects(() => verifications.append('owner', { ...identity, candidateDigest: 'd'.repeat(64) }, result), { status: 404 });
      await client.query("UPDATE tripsit_snapshots SET payload=jsonb_set(payload,'{private}','null'::jsonb) WHERE work_item_id=$1", [item.id]);
      await assert.rejects(() => verifications.list('owner', identity), { status: 404 });
      await assert.rejects(() => verifications.append('owner', identity, result), { status: 404 });
      await client.query("UPDATE tripsit_snapshots SET payload=jsonb_set(payload,'{private}','true'::jsonb) WHERE work_item_id=$1", [item.id]);
      const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => verifications.append('owner', identity, result)));
      assert.equal(attempts.filter(row => row.status === 'fulfilled').length, 3);
      assert.equal((await verifications.list('owner', identity)).length, 4);
      await assert.rejects(() => verifications.append('owner', identity, result), { status: 404 });
      await client.query("UPDATE tripsit_candidate_payloads SET payload=jsonb_set(payload,'{verifications}','[]'::jsonb) || jsonb_build_object('padding', repeat('x',4193000)) WHERE candidate_id=$1", [candidate.id]);
      await assert.rejects(() => verifications.append('owner', identity, result), { status: 404 });
      await client.query("UPDATE tripsit_candidate_payloads SET payload=payload-'padding' WHERE candidate_id=$1", [candidate.id]);
      const saved = await verifications.append('owner', identity, result);
      assert.equal((await verifications.list('owner', identity))[0].digest, saved.digest);
      now = new Date(item.expiresAt);
      await assert.rejects(() => verifications.list('owner', identity), { status: 404 });
      await records.purge();
      assert.equal((await client.query('SELECT count(*)::int AS n FROM tripsit_candidate_payloads')).rows[0].n, 0);
      const metadata = await client.query('SELECT * FROM tripsit_candidates');
      assert.equal(metadata.rowCount, 1);
      assert(!JSON.stringify(metadata.rows).includes('runner-1'));
      assert(!JSON.stringify(metadata.rows).includes(item.id));
    } finally { client.release(); }
  } finally {
    try { if (createdSchema) await pool.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await pool.end(); }
  }
});
