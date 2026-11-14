import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { prioritizeChecks } from '../src/lib/server/priorities.ts';
import { createVerificationRecords } from '../src/lib/server/verification-records.ts';

const identity = { ownerId: 'owner', itemId: '11111111-1111-4111-8111-111111111111', candidateId: '22222222-2222-4222-8222-222222222222', baseSha: 'a'.repeat(40), candidateDigest: 'b'.repeat(64), snapshotDigest: 'c'.repeat(64), policyVersion: 'baseline-1' };
const hashes = { definitionDigest: 'd'.repeat(64), environmentDigest: 'e'.repeat(64), dependencyDigest: 'f'.repeat(64), oracleDigest: '1'.repeat(64) };
const result = { checks: [{ id: 'check-1', mandatory: true, impact: 'unknown' as const, timeoutMs: 1000,
  provenance: 'trusted_repository' as const, requirementIds: ['R1'], nodeIds: ['N1'], ...hashes }],
executions: [{ id: 'execution-1', checkId: 'check-1', collector: 'trusted_runner' as const, runnerId: 'runner-1', prId: null,
  status: 'completed' as const, result: 'failed' as const, exitCode: 1, executedTests: 1, ...hashes }],
admission: { status: 'passed' as const, configurationDigest: '2'.repeat(64), codeDigest: '3'.repeat(64), environmentDigest: hashes.environmentDigest } };
function fixture() {
  const artifacts: Record<string, any>[] = [];
  let fail = false;
  const database = { async query(sql: string, values: unknown[] = []) {
    if (fail) throw Error('credential-secret');
    if (sql.startsWith('UPDATE')) {
      artifacts.push(JSON.parse(values[6] as string));
      return { rows: [{ id: identity.candidateId }] };
    }
    return { rows: [{ verifications: structuredClone(artifacts), payload_bytes: 1024 }] };
  } };
  return { records: createVerificationRecords(database), artifacts, unavailable: () => { fail = true; } };
}

test('immutable verification envelopes preserve original policy/snapshot and reject corruption or cross-owner identity', async () => {
  const { records, artifacts } = fixture();
  const dispatchPlan = prioritizeChecks(result.checks.map(check => ({ ...check, missingEvidence: true, reviewerDisagreement: false })), { model: 'fixture', settingsDigest: '9'.repeat(64), revision: identity.candidateDigest });
  const created = await records.append('owner', identity, { ...result, dispatchPlan });
  assert.deepEqual(created.result.dispatchPlan, dispatchPlan);
  assert.deepEqual(await records.list('owner', identity), [created]);
  assert.deepEqual((await records.list('owner', { ...identity, snapshotDigest: '9'.repeat(64), policyVersion: 'next' }))[0].identity, identity);
  created.result.executions[0].runnerId = 'caller-mutated';
  assert.equal((await records.list('owner', identity))[0].result.executions[0].runnerId, 'runner-1');
  await assert.rejects(() => records.list('other', identity), { status: 404 });
  artifacts[0].identity.candidateDigest = '9'.repeat(64);
  await assert.rejects(() => records.list('owner', identity), { status: 503 });
  artifacts[0].identity = identity;
  artifacts[0].body += ' ';
  await assert.rejects(() => records.list('owner', identity), { status: 503 });
});

test('invalid collector, digests, orphaned executions and false passing results fail before storage', async () => {
  const { records, artifacts } = fixture();
  for (const execution of [{ ...result.executions[0], collector: 'model' }, { ...result.executions[0], checkId: 'unknown' },
    { ...result.executions[0], environmentDigest: '0'.repeat(64) },
    { ...result.executions[0], result: 'passed', executedTests: 0, exitCode: 0 },
    { ...result.executions[0], result: 'passed', status: 'timed_out', exitCode: 0 }]) {
    await assert.rejects(() => records.append('owner', identity, { ...result, executions: [execution] } as any), { status: 400 });
  }
  await assert.rejects(() => records.append('owner', { ...identity, baseSha: 'invalid' }, result), { status: 400 });
  await assert.rejects(() => records.append('owner', identity, { ...result, admission: { ...result.admission, status: 'unverified' } } as any), { status: 400 });
  await assert.rejects(() => records.append('owner', identity, { ...result, checks: [{ ...result.checks[0], signal: { note: 'x'.repeat(512 * 1024) } }] } as any), { status: 413 });
  assert.equal(artifacts.length, 0);
});

test('stored history/count/total payload and safe database failures are bounded', async () => {
  for (const row of [{ verifications: Array(5).fill({}), payload_bytes: 1024 },
    { verifications: [], payload_bytes: 4_194_305 }, { verifications: {}, payload_bytes: 1024 }]) {
    await assert.rejects(() => createVerificationRecords({ async query() { return { rows: [row] }; } }).list('owner', identity), { status: 503 });
  }
  const { records, unavailable } = fixture(); unavailable();
  await assert.rejects(() => records.append('owner', identity, result), error => error.status === 503 && !error.message.includes('secret'));
  await assert.rejects(() => createVerificationRecords({ async query() { return { rows: [] }; } }).append('owner', identity, result), { status: 404 });
});

test('persisted bytes are checked against result structure even when envelope digest matches', async () => {
  const { records, artifacts } = fixture(); await records.append('owner', identity, result);
  const invalid = { ...result, executions: [{ ...result.executions[0], collector: 'model' }] };
  artifacts[0].body = JSON.stringify(invalid); artifacts[0].digest = createHash('sha256').update(artifacts[0].body).digest('hex');
  await assert.rejects(() => records.list('owner', identity), { status: 503 });
});
