import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { createStaging } from '../src/lib/server/staging-service.ts';
import { testDatabaseUrl } from '../src/lib/server/records.ts';

test('disposable database atomically stores stages, rejects cross-owner and stale candidate', async () => {
 const pool = new pg.Pool({ connectionString: testDatabaseUrl(process.env.TRIPSIT_TEST_DATABASE_URL), connectionTimeoutMillis: 5000 });
 const client = await pool.connect();
 try {
  for (const name of ['001_work_items.sql', '002_candidates.sql', '003_candidate_staging.sql']) await client.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  const itemId = randomUUID(), candidateId = randomUUID(), createdAt = new Date('2026-01-01T00:00:00Z'), expiresAt = new Date('2099-01-01T00:00:00Z');
  const snapshot = { repositoryId: 1, repository: 'a/b', private: false, issueNumber: 1, issueId: 2, baseSha: 'a'.repeat(40), supplied: { title: '', body: '', provenance: 'supplied' as const }, inferred: [], ownerConfirmed: [] };
  const content = Buffer.from('hello\n'), blobSha = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
  const file = { path: 'new.txt', originalBlob: null, blobSha, content };
  const candidate = { id: candidateId, candidate: { baseSha: snapshot.baseSha, outputDigest: 'b'.repeat(64), files: [file] } };
  const payload = { baseSha: snapshot.baseSha, outputDigest: candidate.candidate.outputDigest, files: [{ ...file, content: content.toString('base64') }] };
  await client.query('INSERT INTO tripsit_work_items VALUES ($1,$2,$3,$4,$5,$6)', [itemId,'owner','digest','intake',createdAt,expiresAt]);
  await client.query('INSERT INTO tripsit_snapshots VALUES ($1,$2)', [itemId,JSON.stringify(snapshot)]);
  await client.query('INSERT INTO tripsit_candidates VALUES ($1,$2,$3,$4,$5)', [candidateId,'owner',candidate.candidate.outputDigest,createdAt,expiresAt]);
  await client.query('INSERT INTO tripsit_candidate_payloads VALUES ($1,$2,$3)', [candidateId,itemId,JSON.stringify(payload)]);
  const intake = { async get() { return { id: itemId, snapshot, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString() }; } };
  const generation = { async get() { return candidate as never; } };
  const github = { async stagingTree() { return { baseSha: snapshot.baseSha, treeSha: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', entries: [] }; } };
  const service = createStaging({ intake, generation, github, database: pool });
  const result = await service.stage('owner', itemId, candidateId, new AbortController().signal);
  assert.deepEqual(await service.stage('owner', itemId, candidateId, new AbortController().signal), result);
  await assert.rejects(service.stage('other', itemId, candidateId, new AbortController().signal));
  await client.query('DELETE FROM tripsit_candidate_stages WHERE candidate_id=$1', [candidateId]);
  await client.query('BEGIN');
  await client.query('UPDATE tripsit_candidate_payloads SET payload=jsonb_set(payload,\'{files,0,blobSha}\',\'"changed"\') WHERE candidate_id=$1', [candidateId]);
  const pending = service.stage('owner', itemId, candidateId, new AbortController().signal);
  await new Promise(resolve => setTimeout(resolve, 100));
  await client.query('COMMIT');
  await assert.rejects(pending, { status: 409 });
  assert.equal((await client.query('SELECT count(*)::int AS count FROM tripsit_candidate_stages')).rows[0].count, 0);
 } finally { client.release(); await pool.end(); }
});
