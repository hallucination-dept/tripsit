import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildImpact } from '../src/lib/server/impact-extractor.ts';
import { assessmentView } from '../src/lib/server/assessment-view.ts';
import { baselinePolicy } from '../src/lib/server/policy.ts';
import test from 'node:test';
import { createCandidateInspection } from '../src/lib/candidate-inspection.ts';

const item = '11111111-1111-4111-8111-111111111111';
const candidate = '22222222-2222-4222-8222-222222222222';
const reviewId = '33333333-3333-4333-8333-333333333333';
const baseSha = 'a'.repeat(40), candidateDigest = 'b'.repeat(64);
const identity = () => ({ ownerId: 'owner', itemId: item, candidateId: candidate, baseSha, candidateDigest, snapshotDigest: 'c'.repeat(64), policyVersion: 'baseline-1' });
const review = () => ({ id: reviewId, identity: identity(), createdAt: '2026-01-01T00:00:00Z', digest: 'd'.repeat(64), result: {
  status: 'completed', baseSha, candidateDigest, model: 'reviewer', destination: 'https://review.example/v1/chat/completions', retentionDisclosure: '7 days',
  promptDigest: 'e'.repeat(64), responseDigest: 'f'.repeat(64), claims: [
    { id: 'C1', requirementIds: ['R1'], nodeIds: [], statement: 'Supports.', stance: 'supports', counterexample: null },
    { id: 'C2', requirementIds: ['R1'], nodeIds: [], statement: 'Contradicts.', stance: 'contradicts', counterexample: 'Try a second owner.' }
  ], checks: [] } });
const assessment = (reviews: unknown[] = []) => ({ identity: identity(), reviewerConfigured: true, reviews,
  impact: { graph: { revision: { baseSha, headSha: null, candidateDigest }, nodes: [], edges: [], changed: [] }, imports: [], gaps: [],
    impact: { revision: { baseSha, headSha: null, candidateDigest }, affected: [], edges: [], gaps: [], requiresInspection: true,
      coverage: { extraction: 'not_run', semanticResolution: 'not_verified', executableChecks: 'not_run', suppliedNodes: 0, suppliedEdges: 0, unsupportedLanguages: [] } },
    coverage: { extraction: 'js_ts_static_file_imports', semanticResolution: 'not_performed', executableChecks: 'not_run', complete: false, typescriptVersion: '6.0' } },
  packet: { identity: identity(), candidateCommit: null, acceptanceReady: false, packetDigest: 'e'.repeat(64), requirementCoverage: [],
    impact: { status: 'available', summary: 'Incomplete impact.', unknown: true, nodeIds: [], gaps: [] },
    tokenSignal: { mapping: 'unavailable', observedTokens: 0, reason: 'No exact mapping.' }, reviewerClaims: [], conflicts: [], checkDefinitions: [],
    checkPlan: { mandatory: [], selected: [], omitted: [], gaps: [], optionalTimeMs: 0, budget: { optionalChecks: 3, perCheckMs: 60000, totalMs: 180000 } },
    executions: [], evidenceReuse: [], humanInspection: { required: true, reasons: ['Inspect gaps.'] }, gaps: [] } });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test('loads assessment without auto-review; explicit review refreshes stored conflicting claims', async () => {
  const methods: string[] = [];
  let reviews: unknown[] = [];
  const inspection = createCandidateInspection({ fetcher: async (url, init) => {
    assert(String(url).startsWith(`/api/work-items/${item}/candidates/${candidate}/`));
    methods.push(init?.method ?? 'GET');
    assert.equal(init?.credentials, 'same-origin');
    if (init?.method === 'POST') { assert.equal(String(init.body), '{}'); reviews = [review()]; return response({ review: review() }); }
    return response(assessment(reviews));
  } });
  await inspection.select('owner', item, candidate, baseSha, candidateDigest);
  assert.deepEqual(methods, ['GET']);
  assert.equal(inspection.state.loading, false);
  assert.equal(inspection.state.assessment?.reviews.length, 0);
  await inspection.review();
  assert.deepEqual(methods, ['GET', 'POST', 'GET']);
  assert.equal(inspection.state.assessment?.reviews.length, 1);
  const result = inspection.state.assessment!.reviews[0].result;
  if (result.status === 'completed') assert.equal(result.claims.length, 2);
  assert.equal(inspection.state.reviewing, false);
  assert.equal(inspection.state.reviewError, '');
});

test('unconfigured, absent or invalid selection never dispatches a review', async () => {
  let calls = 0;
  const inspection = createCandidateInspection({ fetcher: async () => { calls++; return response({ ...assessment(), reviewerConfigured: false }); } });
  await inspection.review();
  await inspection.select('', item, candidate, baseSha, candidateDigest);
  await inspection.select('owner', '', candidate, baseSha, candidateDigest);
  await inspection.select('owner', item, 'bad', baseSha, candidateDigest);
  assert.equal(calls, 0);
  await inspection.select('owner', item, candidate, baseSha, candidateDigest);
  await inspection.review();
  assert.equal(calls, 1);
  assert(inspection.state.reviewError);
  assert.equal(inspection.state.reviewing, false);
});

test('selection changes and sign-out discard old assessment/review responses even if abort is ignored', async () => {
  const waiting: Array<{ signal: AbortSignal; resolve: (response: Response) => void }> = [];
  let slow = true;
  const inspection = createCandidateInspection({ fetcher: async (_url, init) => {
    if (slow || init?.method === 'POST') return new Promise<Response>(resolve => waiting.push({ signal: init!.signal as AbortSignal, resolve }));
    return response(assessment());
  } });
  const first = inspection.select('owner', item, candidate, baseSha, candidateDigest);
  slow = false;
  await inspection.select('owner', item, candidate, baseSha, candidateDigest);
  assert(waiting[0].signal.aborted);
  waiting.shift()!.resolve(response(assessment()));
  await first;
  const reviewing = inspection.review();
  inspection.stop();
  assert(waiting[0].signal.aborted);
  waiting.shift()!.resolve(response({ review: review() }));
  await reviewing;
  assert.equal(inspection.state.owner, '');
  assert.equal(inspection.state.assessment, null);
  assert.equal(inspection.state.reviewing, false);
});

test('malformed identities, failed review and failed refresh preserve honest busy/error state', async () => {
  let mode = 'load';
  const inspection = createCandidateInspection({ fetcher: async (_url, init) => {
    if (init?.method === 'POST') {
      if (mode === 'network') throw new Error('secret upstream stack');
      if (mode === 'malformed') return response({ review: { ...review(), identity: { ...identity(), ownerId: 'other' } } });
      if (mode === 'failure') return response({ message: 'Review is unavailable.' }, 503);
      mode = 'refresh-failure'; return response({ review: review() });
    }
    if (mode === 'refresh-failure') return response({ message: 'Refresh unavailable.' }, 503);
    if (mode === 'identity') return response({ ...assessment(), identity: { ...identity(), candidateDigest: 'f'.repeat(64) } });
    if (mode === 'packet') return response({ ...assessment(), packet: { ...assessment().packet, identity: { ...identity(), policyVersion: 'other' } } });
    return response(assessment());
  } });
  for (mode of ['identity', 'packet']) {
    await inspection.select('owner', item, candidate, baseSha, candidateDigest);
    assert.equal(inspection.state.assessment, null);
    assert(inspection.state.error);
    assert.equal(inspection.state.loading, false);
  }
  mode = 'load'; await inspection.select('owner', item, candidate, baseSha, candidateDigest);
  for (mode of ['network', 'malformed', 'failure', 'refresh']) {
    await inspection.review();
    assert.equal(inspection.state.reviewing, false);
    assert(inspection.state.reviewError);
    assert(!inspection.state.reviewError.includes('secret'));
    assert.equal(inspection.state.assessment?.reviews.length, 0);
  }
});

test('missing renderable coverage or budget structures cannot publish a partial assessment', async () => {
  for (const malformed of [
    { ...assessment(), impact: { ...assessment().impact, impact: { ...assessment().impact.impact, coverage: null } } },
    { ...assessment(), packet: { ...assessment().packet, checkPlan: { ...assessment().packet.checkPlan, budget: null } } }
  ]) {
    const inspection = createCandidateInspection({ fetcher: async () => response(malformed) });
    await inspection.select('owner', item, candidate, baseSha, candidateDigest);
    assert.equal(inspection.state.assessment, null);
    assert(inspection.state.error);
  }
});

test('actual load accepts an assembled 607-gap extractor view and enforces the finite 4096-gap cap', async () => {
  const source = Array.from({ length: 300 }, (_, index) => `import 'package-${index}';`).join('\n');
  const version = (content: string) => ({ content, blobSha: createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex') });
  const impact = buildImpact({ baseSha, candidateDigest, files: [{ path: 'index.ts', base: version(source), candidate: version(source + '\nexport const added=1;') }], repositoryPaths: ['index.ts'], complete: true });
  const policy = baselinePolicy('unknown');
  const view = assessmentView('owner', { identity: { ...identity(), policyVersion: policy.version }, policy, impact, reviews: [], files: [],
    generation: { model: 'gemma', settingsDigest: 'd'.repeat(64), mapping: { status: 'unavailable', reason: 'No exact mapping.' }, observedTokens: 0 } }, false);
  const inspection = createCandidateInspection({ fetcher: async () => response(view) });
  await inspection.select('owner', item, candidate, baseSha, candidateDigest);
  assert.equal(inspection.state.error, '');
  assert.equal(inspection.state.assessment?.packet.impact.gaps.length, 607);
  view.packet.impact.gaps = Array.from({ length: 4096 }, (_, index) => `gap:${index}`);
  await inspection.select('owner', item, candidate, baseSha, candidateDigest);
  assert.equal(inspection.state.assessment?.packet.impact.gaps.length, 4096);
  view.packet.impact.gaps.push('gap:over-limit');
  await inspection.select('owner', item, candidate, baseSha, candidateDigest);
  assert.equal(inspection.state.assessment, null);
  assert(inspection.state.error);
});
