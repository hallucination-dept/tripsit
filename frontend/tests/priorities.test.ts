import assert from 'node:assert/strict';
import test from 'node:test';
import { prioritizeChecks, type VerificationCheck } from '../src/lib/server/priorities.ts';

const comparison = { model: 'gemma', settingsDigest: 'a'.repeat(64), revision: 'revision-1' };
const signal = (logprobs: number[] = [-1]) => ({ ...comparison, mapping: 'exact' as const, span: { start: 0, end: 20 }, logprobs });
const check = (id: string, extra: Partial<VerificationCheck> = {}): VerificationCheck => ({ id, mandatory: false,
  impact: 'medium', missingEvidence: false, reviewerDisagreement: false, timeoutMs: 60_000, signal: signal(), ...extra });

test('mandatory checks survive optional budgets and high-confidence defects retain impact priority', () => {
  const result = prioritizeChecks([
    check('required', { mandatory: true, signal: signal([0]), timeoutMs: 120_000 }),
    check('rare-name', { impact: 'low', signal: signal([-100]) }),
    check('seeded-defect', { impact: 'critical', signal: signal([0]) }),
    check('extra-1'), check('extra-2'), check('extra-3')
  ], comparison);
  assert.deepEqual(result.mandatory.map(row => row.id), ['required']);
  assert.equal(result.selected.length, 3);
  assert.equal(result.selected[0].id, 'seeded-defect');
  assert.equal(result.selected[0].meanNegativeLogprob, 0);
  assert.deepEqual(result.budget, { optionalChecks: 3, perCheckMs: 60_000, totalMs: 180_000 });
  assert(result.omitted.every(row => row.reasons.includes('optional_check_limit')));
  const none = prioritizeChecks([check('required', { mandatory: true }), check('optional')], comparison,
    { optionalChecks: 0, perCheckMs: 60_000, totalMs: 0 });
  assert.equal(none.mandatory.length, 1);
  assert.equal(none.selected.length, 0);
});

test('uncertainty orders only exact comparable spans after impact and evidence/disagreement', () => {
  const result = prioritizeChecks([check('certain', { signal: signal([-0.01]) }), check('uncertain', { signal: signal([-2, -4]) }),
    check('evidence', { missingEvidence: true, signal: signal([0]) }), check('reviewers', { reviewerDisagreement: true, signal: signal([0]) })], comparison);
  assert.deepEqual([...result.selected, ...result.omitted].map(row => row.id), ['evidence', 'reviewers', 'uncertain', 'certain']);
  assert.equal(result.selected[2].meanNegativeLogprob, 3);
  for (const altered of [undefined, { ...signal(), mapping: 'unavailable' as const }, { ...signal(), span: null },
    signal([]), { ...signal(), model: 'other' }, { ...signal(), settingsDigest: 'b'.repeat(64) }, { ...signal(), revision: 'revision-2' }]) {
    const gap = prioritizeChecks([check('gap', { signal: altered }), check('numerical')], comparison);
    assert.equal(gap.selected[0].id, 'gap');
    assert.equal(gap.selected[0].meanNegativeLogprob, null);
    assert.equal(gap.selected[0].inspection, true);
    assert(gap.gaps.some(item => item.checkId === 'gap'));
  }
});

test('unknown impact remains inspection and ties are stable under input permutations', () => {
  const checks = [check('z'), check('a'), check('unknown', { impact: 'unknown', signal: undefined }), check('high', { impact: 'high' })];
  const forward = prioritizeChecks(checks, comparison);
  assert.deepEqual(prioritizeChecks([...checks].reverse(), comparison), forward);
  assert.deepEqual(forward.selected.map(row => row.id), ['unknown', 'high', 'a']);
  assert.equal(forward.selected[0].inspection, true);
  assert(forward.selected[0].reasons.includes('unknown_impact_requires_inspection'));
  assert(forward.gaps.some(item => item.checkId === 'unknown'));
  assert.equal(forward.omitted[0].id, 'z');
});

test('finite execution caps omit only optional checks and record exact budget reasons', () => {
  const result = prioritizeChecks([check('a-too-long', { timeoutMs: 60_001 }), check('b-first', { timeoutMs: 50_000 }),
    check('c-total', { timeoutMs: 40_000 }), check('d-fits', { timeoutMs: 10_000 })], comparison,
    { optionalChecks: 3, perCheckMs: 60_000, totalMs: 60_000 });
  assert.deepEqual(result.selected.map(row => row.id), ['b-first', 'd-fits']);
  assert(result.omitted.find(row => row.id === 'a-too-long')!.reasons.includes('per_check_timeout_limit'));
  assert(result.omitted.find(row => row.id === 'c-total')!.reasons.includes('total_timeout_limit'));
  assert.equal(result.optionalTimeMs, 60_000);
});

test('rejects malformed inputs and positive/nonfinite raw logprobs instead of inventing risk', () => {
  for (const bad of [0.1, Infinity, -Infinity, NaN]) {
    assert.throws(() => prioritizeChecks([check('bad', { signal: signal([bad]) })], comparison));
  }
  for (const bad of [[], [check('same'), check('same')], [check('', {})], Array(257).fill(check('x')),
    [check('x', { timeoutMs: NaN })], [check('x', { timeoutMs: 0 })], [check('x', { impact: 'invented' as never })],
    [check('x', { signal: { ...signal(), span: { start: 2, end: 1 } } })]]) {
    if (bad.length) assert.throws(() => prioritizeChecks(bad, comparison));
  }
  for (const budget of [{ optionalChecks: -1, perCheckMs: 60000, totalMs: 180000 },
    { optionalChecks: 4, perCheckMs: 60000, totalMs: 180000 }, { optionalChecks: 3, perCheckMs: Infinity, totalMs: 180000 }]) {
    assert.throws(() => prioritizeChecks([], comparison, budget));
  }
  assert.deepEqual(prioritizeChecks([], comparison).selected, []);
});

test('sparse input arrays cannot hide checks or produce nonfinite numerical values', () => {
  assert.throws(() => prioritizeChecks(new Array(1), comparison));
  assert.throws(() => prioritizeChecks([check('sparse', { signal: signal(new Array(1)) })], comparison));
  const result = prioritizeChecks([check('finite', { signal: signal([-Number.MAX_VALUE, -Number.MAX_VALUE]) })], comparison);
  assert(Number.isFinite(result.selected[0].meanNegativeLogprob));
});


test('planning output excludes unrecognized comparison and span properties', () => {
  const supplied = { ...signal(), span: { start: 0, end: 20, unrelated: 'must not export' } };
  const result = prioritizeChecks([check('safe', { signal: supplied })], { ...comparison, unrelated: 'must not export' } as typeof comparison);
  assert(!JSON.stringify(result).includes('must not export'));
});
