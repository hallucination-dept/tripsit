import assert from 'node:assert/strict';
import test from 'node:test';
import { createReviewRecords } from '../src/lib/server/review-records.ts';

const identity = { ownerId: 'owner', itemId: '11111111-1111-4111-8111-111111111111', candidateId: '22222222-2222-4222-8222-222222222222', baseSha: 'a'.repeat(40), candidateDigest: 'b'.repeat(64), snapshotDigest: 'c'.repeat(64), policyVersion: 'baseline-1' };
test('review artifacts preserve exact text and reject altered or stale identities', async () => {
  let saved: unknown;
  const database = { async query(sql: string, values: unknown[] = []) {
    if (sql.startsWith('UPDATE')) { saved = JSON.parse(values[6] as string); return { rows: [{ id: identity.candidateId }] }; }
    return { rows: [{ reviews: [saved] }] };
  } };
  const records = createReviewRecords(database);
  const result = { status: 'unavailable' as const, reason: 'Reviewer unavailable: 雪\r\n' };
  const created = await records.append('owner', identity, result);
  assert.deepEqual((await records.list('owner', identity))[0], created);
  assert.deepEqual(created.result, result);
  await assert.rejects(() => records.list('other', identity), { status: 404 });
  const stored = saved as { body: string };
  stored.body = JSON.stringify({ status: 'unavailable', reason: 'changed' });
  await assert.rejects(() => records.list('owner', identity), { status: 503 });
});

test('review storage fails safely on missing, exhausted or unavailable candidate storage', async () => {
  for (const database of [{ async query() { return { rows: [] }; } }, { async query() { throw new Error('secret database details'); } }]) {
    const records = createReviewRecords(database);
    await assert.rejects(() => records.append('owner', identity, { status: 'unavailable', reason: 'Not configured.' }), error => !error.message.includes('secret'));
  }
  const records = createReviewRecords({ async query() { throw new Error('must not query'); } });
  await assert.rejects(() => records.append('owner', { ...identity, candidateDigest: 'invalid' }, { status: 'unavailable', reason: 'Not configured.' }), { status: 400 });
});
