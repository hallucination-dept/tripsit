import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewerGate } from '../scripts/reviewer-gate.ts';

const environment = { REVIEWER_API_URL: 'https://reviewer.example/prefix', REVIEWER_API_KEY: 'credential-secret',
  REVIEWER_MODEL: 'reviewer-fixture', REVIEWER_RETENTION_DISCLOSURE: 'Synthetic fixture retained for 1 day.' };
const content = { claims: [{ id: 'C1', requirementIds: ['R1'], nodeIds: ['N1'], statement: 'Zero division returns Infinity.',
  stance: 'contradicts', counterexample: 'divide(1, 0)' }], checks: [{ id: 'T1', requirementIds: ['R1'], nodeIds: ['N1'], description: 'Assert zero division returns null.' }] };
function endpoint(proposals: unknown = content) {
  return (async (_url: unknown, options?: RequestInit) => {
    const body = JSON.parse(options?.body as string);
    assert.equal(body.messages[0].role, 'system');
    assert.match(body.messages[0].content, /untrusted data/);
    assert.equal(body.messages[1].role, 'user');
    assert.equal(body.model, environment.REVIEWER_MODEL);
    assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer credential-secret');
    assert.equal(JSON.parse(body.messages[1].content).private, false);
    return Response.json({ model: environment.REVIEWER_MODEL, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(proposals) } }] });
  }) as typeof fetch;
}

test('configured reviewer gate dispatches real client schema and emits only source-free identities', async () => {
  const result = await reviewerGate(environment, AbortSignal.timeout(1000), endpoint());
  assert.equal(result.status, 'passed_configured_reviewer');
  assert.equal(result.scope, 'public_synthetic_provider_contract');
  assert.equal(result.authenticatedOwnerUat, 'unverified');
  assert.equal(result.privateAdmission, 'unverified');
  assert.equal(result.claimCount, 1);
  assert.equal(result.checkCount, 1);
  for (const key of ['fixtureDigest', 'promptDigest', 'responseDigest', 'configurationDigest']) assert.match(result[key] as string, /^[a-f0-9]{64}$/);
  const raw = JSON.stringify(result);
  for (const secret of ['credential-secret', 'reviewer.example', 'Zero division', 'divide(1, 0)', 'Synthetic fixture retained']) assert.ok(!raw.includes(secret));
});

test('missing config never dispatches and empty or unlinked proposals cannot pass the gate', async () => {
  let calls = 0;
  const missing = await reviewerGate({}, AbortSignal.timeout(1000), (async () => { calls++; throw Error('secret'); }) as typeof fetch);
  assert.equal(missing.status, 'failed');
  assert.equal(calls, 0);
  for (const proposals of [{ claims: [], checks: [] }, { ...content, claims: [] }, { ...content, checks: [] },
    { ...content, claims: [{ ...content.claims[0], nodeIds: [] }] },
    { ...content, claims: [{ ...content.claims[0], requirementIds: ['unknown'] }] }]) {
    const result = await reviewerGate(environment, AbortSignal.timeout(1000), endpoint(proposals));
    assert.equal(result.status, 'failed');
    assert.ok(!JSON.stringify(result).includes('credential-secret'));
  }
});

test('cancellation fails without source or provider errors', async () => {
  const controller = new AbortController();
  const waiting = reviewerGate(environment, controller.signal, (async () => new Promise(() => {})) as typeof fetch);
  controller.abort();
  const result = await waiting;
  assert.equal(result.status, 'failed');
  assert.equal(result.authenticatedOwnerUat, 'unverified');
});
