import assert from 'node:assert/strict';
import test from 'node:test';
import { assessmentView } from '../src/lib/server/assessment-view.ts';
import type { Assessment } from '../src/lib/server/assessment.ts';
import { baselinePolicy } from '../src/lib/server/policy.ts';
import { analyzeImpact, type ImpactGraph } from '../src/lib/server/impact.ts';
const digest = (char = 'a') => char.repeat(64);
function fixture(): Assessment {
  const policy = baselinePolicy('unknown');
  const identity = { ownerId: 'owner', itemId: '11111111-1111-4111-8111-111111111111', candidateId: '22222222-2222-4222-8222-222222222222', baseSha: 'a'.repeat(40), candidateDigest: digest('b'), snapshotDigest: digest('c'), policyVersion: policy.version };
  const graph: ImpactGraph = { revision: { baseSha: identity.baseSha, headSha: null, candidateDigest: identity.candidateDigest }, nodes: [], edges: [], changed: ['missing'] };
  return { identity, generation: { model: 'gemma', settingsDigest: digest('d'), mapping: { status: 'unavailable', reason: 'No exact mapping.' }, observedTokens: 12 }, policy,
    impact: { graph, impact: analyzeImpact(graph), imports: [], gaps: [], coverage: { extraction: 'js_ts_static_file_imports', semanticResolution: 'not_performed', executableChecks: 'not_run', complete: false, typescriptVersion: '6.0.3' } }, reviews: [],
    files: [{ path: 'src/a.ts', original: 'raw-original-secret', replacement: 'raw-candidate-secret' }] };
}

test('view binds actual policy/model/token identity and omits raw files with honest missing controls', () => {
  const input = fixture();
  const result = assessmentView('owner', input, false);
  assert.deepEqual(result.identity, input.identity);
  assert.equal(result.reviewerConfigured, false);
  assert.equal(result.packet.identity.candidateDigest, input.identity.candidateDigest);
  assert.equal(result.packet.checkPlan.comparison.model, 'gemma');
  assert.equal(result.packet.checkPlan.comparison.settingsDigest, input.generation.settingsDigest);
  assert.equal(result.packet.tokenSignal.observedTokens, 12);
  assert.equal(result.packet.tokenSignal.mapping, 'unavailable');
  assert.equal(result.packet.verification.status, 'unavailable');
  assert.equal(result.packet.acceptanceReady, false);
  assert.equal(result.packet.candidateCommit, null);
  assert.equal(result.packet.checkDefinitions.length, 0);
  const rendered = JSON.stringify(result);
  assert(!rendered.includes('raw-original-secret'));
  assert(!rendered.includes('raw-candidate-secret'));
  assert(!Object.hasOwn(result, 'files'));
});

test('completed review claims retain original identity/digest, counterexamples and conflicts without invented executions', () => {
  const input = fixture();
  input.reviews = ['supports', 'contradicts'].map((stance, index) => ({ id: `${index + 3}3333333-3333-4333-8333-333333333333`, identity: { ...input.identity }, createdAt: '2026-01-01T00:00:00Z', digest: digest(String(index)), result: {
    status: 'completed' as const, baseSha: input.identity.baseSha, candidateDigest: input.identity.candidateDigest, model: 'independent-reviewer', destination: 'https://reviewer.example/v1/chat/completions', retentionDisclosure: 'Configured retention.', promptDigest: digest('e'), responseDigest: digest('f'),
    claims: [{ id: 'claim', requirementIds: [input.policy.requirements[0].id], nodeIds: [], statement: '<script>untrusted claim</script>', stance: stance as 'supports' | 'contradicts', counterexample: '<img src=x onerror=bad()>' }], checks: [{ id: 'proposed', requirementIds: [input.policy.requirements[0].id], nodeIds: [], description: 'A model proposal, never an execution.' }]
  } }));
  const result = assessmentView('owner', input, true);
  assert.equal(result.packet.conflicts.length, 1);
  assert.equal(result.reviews.length, 2);
  assert.equal(result.packet.reviewerClaims[0].artifactDigest, input.reviews[0].digest);
  assert.equal(result.packet.reviewerClaims[0].claims[0].proposition, '<script>untrusted claim</script>');
  assert.equal(result.packet.reviewerClaims[0].claims[0].counterexample, '<img src=x onerror=bad()>');
  assert.equal(result.packet.executions.length, 0);
  assert.equal(result.packet.checkDefinitions.length, 0);
  input.reviews[0].identity.candidateDigest = digest('9');
  const stale = assessmentView('owner', input, true);
  assert.equal(stale.packet.reviewerClaims.length, 1);
  assert.equal(stale.reviews.length, 1);
  assert(stale.packet.gaps.some(gap => gap.kind === 'stale_artifact'));
});

test('unavailable reviews remain unavailable; owner mismatch denies and equivalent object key order has stable digest', () => {
  const input = fixture();
  input.reviews = [{ id: '33333333-3333-4333-8333-333333333333', identity: { ...input.identity }, createdAt: '2026-01-01T00:00:00Z', digest: digest(), result: { status: 'unavailable', reason: 'Reviewer is not configured.' } }];
  const result = assessmentView('owner', input, false);
  assert.equal(result.reviews[0].result.status, 'unavailable');
  assert.equal(result.packet.reviewerClaims.length, 0);
  const reordered = structuredClone(input);
  reordered.generation = Object.fromEntries(Object.entries(reordered.generation).reverse()) as Assessment['generation'];
  assert.equal(assessmentView('owner', reordered, false).packet.packetDigest, result.packet.packetDigest);
  assert.throws(() => assessmentView('other', input, false));
  input.reviews[0].identity.ownerId = 'other';
  assert.throws(() => assessmentView('owner', input, false));
});


test('policy and impact artifacts keep their actual revision identities instead of relabeling stale data', () => {
  const input = fixture();
  input.policy.version = 'historical-policy';
  input.impact.graph.revision = { baseSha: input.identity.baseSha, headSha: null, candidateDigest: digest('9') };
  const result = assessmentView('owner', input, true);
  assert.equal(result.packet.requirementCoverage.length, 0);
  assert.equal(result.packet.impact.status, 'unavailable');
  assert(result.packet.gaps.some(gap => gap.kind === 'stale_artifact' && gap.reference === 'policy'));
  assert(result.packet.gaps.some(gap => gap.kind === 'stale_artifact' && gap.reference === 'impact'));
});


test('historical policy and snapshot reviews remain packet gaps without appearing as current raw reviews', () => {
  for (const changed of [{ policyVersion: 'older-policy' }, { snapshotDigest: digest('8') }]) {
    const input = fixture();
    input.reviews = [{ id: '33333333-3333-4333-8333-333333333333', identity: { ...input.identity, ...changed },
      createdAt: '2026-01-01T00:00:00Z', digest: digest(), result: { status: 'completed',
        baseSha: input.identity.baseSha, candidateDigest: input.identity.candidateDigest, model: 'historical-reviewer',
        destination: 'https://reviewer.example', retentionDisclosure: 'Configured retention.', promptDigest: digest('e'), responseDigest: digest('f'),
        claims: [{ id: 'old-claim', requirementIds: [input.policy.requirements[0].id], nodeIds: [], statement: 'Historical support', stance: 'supports', counterexample: null }], checks: [] } }];
    const result = assessmentView('owner', input, true);
    assert.equal(result.reviews.length, 0);
    assert.equal(result.packet.reviewerClaims.length, 0);
    assert(result.packet.gaps.some(gap => gap.kind === 'stale_artifact'));
    assert.equal(input.reviews.length, 1, 'Historical input must remain intact');
  }
});
