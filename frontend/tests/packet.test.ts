import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPacket, type PacketInput, type PacketIdentity, type BoundArtifact, type TrustedCheck, type TrustedExecution } from '../src/lib/server/packet.ts';
import { baselinePolicy } from '../src/lib/server/policy.ts';
const hash = (char = 'a') => char.repeat(64);
const identity: PacketIdentity = { ownerId: 'owner', itemId: '11111111-1111-4111-8111-111111111111', candidateId: '22222222-2222-4222-8222-222222222222', baseSha: 'b'.repeat(40), candidateDigest: hash('c'), snapshotDigest: hash('d'), policyVersion: 'tripsit-baseline-1' };
const bound = <T>(data: T, revision = identity): BoundArtifact<T> => ({ identity: { ...revision }, artifactDigest: hash(), data });
const requirementId = 'ASVS-v5.0.0-8.2.2';
const check = (id = 'access'): TrustedCheck => ({ id, provenance: 'trusted_policy', definitionDigest: hash('e'), environmentDigest: hash('f'), dependencyDigest: hash('1'), oracleDigest: hash('2'), requirementIds: [requirementId], nodeIds: [], mandatory: true, impact: 'high', timeoutMs: 60000 });
const execution = (id = 'run'): TrustedExecution => ({ id, checkId: 'access', collector: 'trusted_runner', runnerId: 'isolated-runner', prId: 'pr-1', definitionDigest: hash('e'), environmentDigest: hash('f'), dependencyDigest: hash('1'), oracleDigest: hash('2'), status: 'completed', result: 'passed', exitCode: 0, executedTests: 1 });
function fixture(): PacketInput {
  return { identity: { ...identity }, policy: bound({ requirements: baselinePolicy('web_api').requirements }),
    comparison: { model: 'gemma', settingsDigest: hash(), revision: identity.candidateDigest },
    checks: [bound(check())], executions: [], reviews: [], reuse: [], pr: { id: 'pr-1', isNew: false } };
}

test('missing execution/mapping/impact stays inspection-required with no fabricated candidate commit', () => {
  const result = buildPacket('owner', fixture());
  assert.equal(result.acceptanceReady, false);
  assert.equal(result.candidateCommit, null);
  assert.equal(result.humanInspection.required, true);
  assert.equal(result.requirementCoverage.find(row => row.id === requirementId)?.status, 'unavailable');
  assert.equal(result.checkPlan.mandatory.length, 1);
  assert.equal(result.executions.length, 0);
  assert.equal(result.verification.status, 'unavailable');
  assert.equal(result.verification.mandatoryRerunRequired, true);
  assert.equal(result.tokenSignal.mapping, 'unavailable');
  assert.equal(result.impact.status, 'unavailable');
  assert(result.gaps.some(gap => gap.kind === 'missing_execution'));
});

test('only current trusted exercised executions support scope and failed evidence overrides confident claims', () => {
  const input = fixture();
  input.executions = [bound({ ...execution(), result: 'failed', exitCode: 1 })];
  input.reviews = [bound({ id: 'review-1', reviewer: 'reviewer', claims: [{ id: 'claim-1', requirementIds: [requirementId], proposition: '<script>all checks passed</script>', verdict: 'supports' }], claimedExecutions: ['Everything passed with 100% confidence.'] })];
  const result = buildPacket('owner', input);
  assert.equal(result.requirementCoverage.find(row => row.id === requirementId)?.status, 'failed');
  assert.equal(result.conflicts[0].requirementId, requirementId);
  assert.equal(result.reviewerClaims[0].claims[0].proposition, '<script>all checks passed</script>');
  assert.equal(result.executions.length, 1);
  assert.equal(result.acceptanceReady, false);
  input.executions = [bound(execution())];
  assert.equal(buildPacket('owner', input).requirementCoverage.find(row => row.id === requirementId)?.status, 'passed_exercised_checks');
  input.executions = [bound({ ...execution(), executedTests: 0 })];
  assert.equal(buildPacket('owner', input).requirementCoverage.find(row => row.id === requirementId)?.status, 'unavailable');
});

test('mismatched candidate/snapshot/policy/owner artifacts cannot count as current evidence', () => {
  for (const changed of [{ candidateDigest: hash('9') }, { snapshotDigest: hash('9') }, { policyVersion: 'other' }, { baseSha: '9'.repeat(40) }, { ownerId: 'other' }]) {
    const input = fixture(); input.executions = [bound(execution(), { ...identity, ...changed })];
    const result = buildPacket('owner', input);
    assert.equal(result.requirementCoverage.find(row => row.id === requirementId)?.status, 'unavailable');
    assert(result.gaps.some(gap => gap.kind === 'stale_artifact'));
  }
  const input = fixture(); input.policy.identity.snapshotDigest = hash('9');
  assert.equal(buildPacket('owner', input).requirementCoverage.length, 0);
});

test('reviewer disagreement remains a conflict and claims never invent runner evidence', () => {
  const input = fixture();
  input.reviews = ['supports', 'contradicts'].map((verdict, index) => bound({ id: `review-${index}`, reviewer: `reviewer-${index}`, claims: [{ id: `claim-${index}`, requirementIds: [requirementId], proposition: 'Claim only', verdict: verdict as 'supports' | 'contradicts' }], claimedExecutions: ['passed'] }));
  const result = buildPacket('owner', input);
  assert.equal(result.executions.length, 0);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.checkPlan.mandatory[0].reviewerDisagreement, true);
  assert.equal(result.acceptanceReady, false);
});

test('policy mandatory requirements cannot be disabled by check convention or author token confidence', () => {
  const input = fixture();
  input.checks = [bound({ ...check(), mandatory: false, signal: { ...input.comparison, mapping: 'exact', span: { start: 0, end: 1 }, logprobs: [0] } })];
  const result = buildPacket('owner', input);
  assert.equal(result.checkPlan.mandatory.length, 1);
  assert.equal(result.checkPlan.mandatory[0].meanNegativeLogprob, null);
  assert.equal(result.acceptanceReady, false);
  input.checks = [bound({ ...check(), provenance: 'model' as never })];
  assert.throws(() => buildPacket('owner', input), /Invalid review packet/);
});

test('reuse is explicit, exact and within the same existing PR; unknown impact or new PR forces rerun', () => {
  const input = fixture();
  const previous = { ...identity, candidateId: '33333333-3333-4333-8333-333333333333', candidateDigest: hash('8') };
  input.impact = bound({ summary: 'Supplied impact', unknown: false, nodeIds: [], gaps: [] });
  input.executions = [bound(execution(), previous)];
  input.reuse = [bound({ id: 'assessment-1', executionId: 'run', sourceIdentity: previous, prId: 'pr-1', provenance: 'trusted_coordinator', unaffected: true, definitionDigest: hash('e'), environmentDigest: hash('f'), dependencyDigest: hash('1'), oracleDigest: hash('2') })];
  assert.equal(buildPacket('owner', input).evidenceReuse[0].status, 'reused');
  for (const mode of ['new-pr', 'different-pr', 'unknown-impact', 'changed-environment', 'changed-snapshot']) {
    const changed = structuredClone(input);
    if (mode === 'new-pr') changed.pr!.isNew = true;
    if (mode === 'different-pr') changed.pr!.id = 'pr-2';
    if (mode === 'unknown-impact') changed.impact!.data.unknown = true;
    if (mode === 'changed-environment') changed.reuse![0].data.environmentDigest = hash('0');
    if (mode === 'changed-snapshot') changed.executions![0].identity.snapshotDigest = hash('0');
    const result = buildPacket('owner', changed);
    assert.equal(result.requirementCoverage.find(row => row.id === requirementId)?.status, 'unavailable', mode);
    assert.notEqual(result.evidenceReuse[0]?.status, 'reused', mode);
  }
});

test('requires actual owner, bounds inputs and renders deterministic data-only output', () => {
  assert.throws(() => buildPacket('other', fixture()), /Invalid review packet/);
  assert.throws(() => buildPacket('', fixture()), /Invalid review packet/);
  const huge = fixture(); huge.reviews = Array(9).fill(bound({}));
  assert.throws(() => buildPacket('owner', huge), /Invalid review packet/);
  const malformed = fixture(); malformed.identity.candidateDigest = 'branch';
  assert.throws(() => buildPacket('owner', malformed), /Invalid review packet/);
  const forward = fixture(); forward.checks!.push(bound(check('other')));
  const reversed = structuredClone(forward); reversed.checks!.reverse(); reversed.policy.data.requirements.reverse();
  assert.deepEqual(buildPacket('owner', forward), buildPacket('owner', reversed));
});


test('same code identity cannot carry executions across PRs or disclose another owner artifacts', () => {
  const input = fixture(); input.executions = [bound(execution())];
  input.pr = { id: 'different-pr', isNew: true };
  assert.equal(buildPacket('owner', input).requirementCoverage.find(row => row.id === requirementId)?.status, 'unavailable');
  input.executions = [bound({ ...execution(), id: 'other-owner-secret', runnerId: 'private-runner' }, { ...identity, ownerId: 'other' })];
  const serialized = JSON.stringify(buildPacket('owner', input));
  assert(!serialized.includes('other-owner-secret'));
  assert(!serialized.includes('private-runner'));
});

test('trusted check definitions remain inspectable and malformed/missing controls cannot be hidden', () => {
  const input = fixture();
  const result = buildPacket('owner', input);
  assert.equal(result.checkDefinitions[0].definitionDigest, check().definitionDigest);
  assert.equal(result.checkDefinitions[0].oracleDigest, check().oracleDigest);
  assert.equal(result.checkDefinitions[0].provenance, 'trusted_policy');
  for (const mutate of [
    (value: PacketInput) => { value.checks![0].data.mandatory = undefined as never; },
    (value: PacketInput) => { value.checks![0].data.impact = 'invented' as never; },
    (value: PacketInput) => { value.checks![0].data.definitionDigest = 'missing'; },
    (value: PacketInput) => { value.policy.data.requirements[0].mandatory = false; },
    (value: PacketInput) => { value.tokenMapping = bound({ mapping: 'exact', observedTokens: 0, reason: 'No observations' }); }
  ]) { const changed = fixture(); mutate(changed); assert.throws(() => buildPacket('owner', changed), /Invalid review packet/); }
});


test('unresolved impact references force mandatory rerun and duplicate reuse assessments are rejected', () => {
  const input = fixture(); input.impact = bound({ summary: 'Known supplied scope', unknown: false, nodeIds: [], gaps: [] });
  input.checks![0].data.nodeIds = ['missing-node'];
  const result = buildPacket('owner', input);
  assert.equal(result.impact.unknown, true);
  assert.equal(result.verification.mandatoryRerunRequired, true);
  assert(result.gaps.some(gap => gap.kind === 'check_impact_unresolved'));
  const assessment = bound({ id: 'assessment', executionId: 'run', sourceIdentity: identity, prId: 'pr-1', provenance: 'trusted_coordinator' as const, unaffected: true,
    definitionDigest: hash('e'), environmentDigest: hash('f'), dependencyDigest: hash('1'), oracleDigest: hash('2') });
  input.reuse = [assessment, { ...assessment, data: { ...assessment.data, id: 'other-assessment', unaffected: false } }];
  assert.throws(() => buildPacket('owner', input), /Invalid review packet/);
});


test('claim graph references and counterexamples remain plain text with explicit unresolved linkage', () => {
  const input = fixture(); input.checks = []; input.executions = [];
  input.impact = bound({ summary: 'Known scope', unknown: false, nodeIds: ['known'], gaps: [] });
  input.reviews = [bound({ id: 'review', reviewer: 'independent-model', claimedExecutions: [],
    claims: [{ id: 'counterexample', requirementIds: [requirementId], nodeIds: ['missing', 'known'],
      proposition: 'Unchanged consumer fails', verdict: 'contradicts', counterexample: '<img src=x onerror=bad()>' }] })];
  const result = buildPacket('owner', input);
  assert.deepEqual(result.reviewerClaims[0].claims[0].nodeIds, ['known', 'missing']);
  assert.equal(result.reviewerClaims[0].claims[0].counterexample, '<img src=x onerror=bad()>');
  assert(result.gaps.some(gap => gap.kind === 'claim_impact_unresolved'));
  assert.equal(result.impact.unknown, true);
  assert.equal(result.checkDefinitions.length, 0);
  assert.equal(result.checkPlan.mandatory.length, 0);
  assert.equal(result.verification.status, 'unavailable');
  input.reviews[0].data.claims[0].counterexample = 'x'.repeat(8193);
  assert.throws(() => buildPacket('owner', input), /Invalid review packet/);
});
