export type PriorityComparison = { model: string; settingsDigest: string; revision: string };
export type SelectedTokenSignal = PriorityComparison & {
  mapping: 'exact' | 'unavailable'; span: { start: number; end: number } | null; logprobs: number[];
};
export type VerificationCheck = {
  id: string; mandatory: boolean; impact: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  missingEvidence: boolean; reviewerDisagreement: boolean; timeoutMs: number; signal?: SelectedTokenSignal;
};
export type OptionalBudget = { optionalChecks: number; perCheckMs: number; totalMs: number };
type Priority = Omit<VerificationCheck, 'signal'> & {
  signal: SelectedTokenSignal | null; meanNegativeLogprob: number | null;
  signalStatus: 'comparable' | 'missing' | 'unmapped' | 'incomparable'; inspection: boolean; reasons: string[];
};
const defaults: OptionalBudget = { optionalChecks: 3, perCheckMs: 60_000, totalMs: 180_000 };
const impactRank = { unknown: 0, critical: 1, high: 2, medium: 3, low: 4 };
const object = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
const integer = (value: number, min: number, max: number) => Number.isSafeInteger(value) && value >= min && value <= max;
const invalid = (): never => { throw new Error('Invalid verification priority input.'); };
function identity(value: PriorityComparison) {
  if (!object(value) || !text(value.model) || !text(value.revision)
    || typeof value.settingsDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.settingsDigest)) invalid();
}
function stableId(left: Priority, right: Priority) { return left.id < right.id ? -1 : left.id > right.id ? 1 : 0; }

/** Coordinator-supplied checks and mapping identities only; this function plans, never executes. */
export function prioritizeChecks(trustedChecks: readonly VerificationCheck[], comparison: PriorityComparison,
  budget: OptionalBudget = defaults) {
  identity(comparison);
  if (!object(budget) || !integer(budget.optionalChecks, 0, 3) || !integer(budget.perCheckMs, 1, 60_000)
    || !integer(budget.totalMs, 0, 180_000) || !Array.isArray(trustedChecks) || trustedChecks.length > 256) invalid();
  const ids = new Set<string>();
  const gaps: Array<{ checkId: string; reason: string }> = [];
  const priorities: Priority[] = Array.from(trustedChecks).map(check => {
    if (!object(check) || !text(check.id) || ids.has(check.id) || typeof check.mandatory !== 'boolean'
      || !Object.hasOwn(impactRank, check.impact) || typeof check.missingEvidence !== 'boolean'
      || typeof check.reviewerDisagreement !== 'boolean' || !integer(check.timeoutMs, 1, 3_600_000)) invalid();
    ids.add(check.id);
    let signalStatus: Priority['signalStatus'] = 'missing';
    let meanNegativeLogprob: number | null = null;
    let signal: SelectedTokenSignal | null = null;
    if (check.signal !== undefined) {
      const supplied = check.signal;
      identity(supplied);
      if (!['exact', 'unavailable'].includes(supplied.mapping) || !Array.isArray(supplied.logprobs)
        || supplied.logprobs.length > 8192) invalid();
      for (const value of supplied.logprobs) if (typeof value !== 'number' || !Number.isFinite(value) || value > 0) invalid();
      if (supplied.span !== null && (!object(supplied.span) || !integer(supplied.span.start, 0, Number.MAX_SAFE_INTEGER)
        || !integer(supplied.span.end, 1, Number.MAX_SAFE_INTEGER) || supplied.span.end <= supplied.span.start)) invalid();
      signal = { model: supplied.model, settingsDigest: supplied.settingsDigest, revision: supplied.revision,
        mapping: supplied.mapping, span: supplied.span === null ? null : { start: supplied.span.start, end: supplied.span.end }, logprobs: [...supplied.logprobs] };
      if (signal.mapping !== 'exact' || signal.span === null) signalStatus = 'unmapped';
      else if (signal.model !== comparison.model || signal.settingsDigest !== comparison.settingsDigest || signal.revision !== comparison.revision) signalStatus = 'incomparable';
      else if (signal.logprobs.length > 0) {
        signalStatus = 'comparable';
        meanNegativeLogprob = 0;
        // Incremental mean avoids overflowing a finite logprob sum.
        for (let index = 0; index < signal.logprobs.length; index++) meanNegativeLogprob += (-signal.logprobs[index] - meanNegativeLogprob) / (index + 1);
      }
    }
    const reasons = [`impact_${check.impact}`];
    if (check.mandatory) reasons.push('trusted_mandatory_outside_optional_budget');
    if (check.impact === 'unknown') {
      reasons.push('unknown_impact_requires_inspection');
      gaps.push({ checkId: check.id, reason: 'Unknown impact requires inspection; it is not low risk.' });
    }
    if (check.missingEvidence) { reasons.push('missing_evidence'); gaps.push({ checkId: check.id, reason: 'Behavioral evidence is missing.' }); }
    if (check.reviewerDisagreement) { reasons.push('reviewer_disagreement'); gaps.push({ checkId: check.id, reason: 'Reviewer disagreement requires inspection.' }); }
    reasons.push(`signal_${signalStatus}`);
    if (signalStatus !== 'comparable') gaps.push({ checkId: check.id, reason: `Token signal is ${signalStatus}; numerical uncertainty is unavailable.` });
    return { id: check.id, mandatory: check.mandatory, impact: check.impact, missingEvidence: check.missingEvidence,
      reviewerDisagreement: check.reviewerDisagreement, timeoutMs: check.timeoutMs, signal, signalStatus,
      meanNegativeLogprob, inspection: check.impact === 'unknown' || check.missingEvidence || check.reviewerDisagreement || signalStatus !== 'comparable', reasons };
  });
  const mandatory = priorities.filter(check => check.mandatory).sort(stableId);
  const optional = priorities.filter(check => !check.mandatory).sort((left, right) =>
    impactRank[left.impact] - impactRank[right.impact]
    || Number(right.missingEvidence) - Number(left.missingEvidence)
    || Number(right.reviewerDisagreement) - Number(left.reviewerDisagreement)
    || Number(left.signalStatus === 'comparable') - Number(right.signalStatus === 'comparable')
    || (left.meanNegativeLogprob !== null && right.meanNegativeLogprob !== null ? right.meanNegativeLogprob - left.meanNegativeLogprob : 0)
    || stableId(left, right));
  const selected: Priority[] = [];
  const omitted: Priority[] = [];
  let optionalTimeMs = 0;
  for (const check of optional) {
    const omission = check.timeoutMs > budget.perCheckMs ? 'per_check_timeout_limit'
      : selected.length >= budget.optionalChecks ? 'optional_check_limit'
      : optionalTimeMs + check.timeoutMs > budget.totalMs ? 'total_timeout_limit' : null;
    if (omission) omitted.push({ ...check, reasons: [...check.reasons, omission] });
    else { selected.push({ ...check, reasons: [...check.reasons, 'selected_within_optional_budget'] }); optionalTimeMs += check.timeoutMs; }
  }
  gaps.sort((left, right) => left.checkId < right.checkId ? -1 : left.checkId > right.checkId ? 1 : left.reason < right.reason ? -1 : left.reason > right.reason ? 1 : 0);
  return { comparison: { model: comparison.model, settingsDigest: comparison.settingsDigest, revision: comparison.revision }, budget: { ...budget }, mandatory, selected, omitted, optionalTimeMs, gaps };
}
