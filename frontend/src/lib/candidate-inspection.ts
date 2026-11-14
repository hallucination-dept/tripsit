import type { ReviewIdentity, StoredReview } from './server/review-records.ts';
import type { buildImpact } from './server/impact-extractor.ts';
import type { buildPacket } from './server/packet.ts';

export type AssessmentView = { identity: ReviewIdentity; impact: ReturnType<typeof buildImpact>;
  packet: ReturnType<typeof buildPacket>; reviews: StoredReview[]; reviewerConfigured: boolean; verificationConfigured?: boolean; dispatchPlan?: ReturnType<typeof buildPacket>['checkPlan'] | null };
export type CandidateInspectionState = {
  owner: string; itemId: string; candidateId: string; baseSha: string; candidateDigest: string;
  loading: boolean; reviewing: boolean; verifying: boolean; assessment: AssessmentView | null; error: string; reviewError: string;
};
type Options = { onChange?: (state: CandidateInspectionState) => void; fetcher?: typeof fetch };
type Selection = Pick<CandidateInspectionState, 'owner' | 'itemId' | 'candidateId' | 'baseSha' | 'candidateDigest'>;
const fields = ['ownerId', 'itemId', 'candidateId', 'baseSha', 'candidateDigest', 'snapshotDigest', 'policyVersion'] as const;
const empty = (): CandidateInspectionState => ({ owner: '', itemId: '', candidateId: '', baseSha: '', candidateDigest: '',
  loading: false, reviewing: false, verifying: false, assessment: null, error: '', reviewError: '' });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 8192): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha = (value: unknown) => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const strings = (value: unknown, max = 512) => Array.isArray(value) && value.length <= max && Array.from(value).every(row => text(row));
function rows(value: unknown, max: number, validate: (row: Record<string, unknown>) => boolean = () => true): boolean {
  return Array.isArray(value) && value.length <= max && Array.from(value).every(row => object(row) && validate(row));
}
function identity(value: unknown, selected: Selection): value is ReviewIdentity {
  return object(value) && Object.keys(value).length === fields.length && value.ownerId === selected.owner
    && value.itemId === selected.itemId && value.candidateId === selected.candidateId && value.baseSha === selected.baseSha
    && value.candidateDigest === selected.candidateDigest && digest(value.snapshotDigest) && text(value.policyVersion, 128);
}
function same(left: unknown, right: ReviewIdentity) { return object(left) && fields.every(key => left[key] === right[key]); }
function storedReview(value: unknown, selected: Selection, revision: ReviewIdentity): value is StoredReview {
  if (!object(value) || !uuid(value.id) || !identity(value.identity, selected) || !same(value.identity, revision)
    || !text(value.createdAt, 128) || !Number.isFinite(Date.parse(value.createdAt)) || !digest(value.digest) || !object(value.result)) return false;
  const result = value.result;
  if (result.status === 'unavailable') return text(result.reason, 512);
  return result.status === 'completed' && result.baseSha === selected.baseSha && result.candidateDigest === selected.candidateDigest
    && ['model', 'destination', 'retentionDisclosure'].every(key => text(result[key], 2048)) && digest(result.promptDigest) && digest(result.responseDigest)
    && rows(result.claims, 32, claim => text(claim.id, 128) && text(claim.statement) && typeof claim.stance === 'string'
      && ['supports', 'contradicts', 'uncertain'].includes(claim.stance) && strings(claim.requirementIds, 128) && strings(claim.nodeIds)
      && (claim.counterexample === null || text(claim.counterexample)))
    && rows(result.checks, 32, check => text(check.id, 128) && text(check.description) && strings(check.requirementIds, 128) && strings(check.nodeIds));
}
function assessment(value: unknown, selected: Selection): value is AssessmentView {
  if (!object(value) || !identity(value.identity, selected) || typeof value.reviewerConfigured !== 'boolean'
    || !rows(value.reviews, 8, review => storedReview(review, selected, value.identity as ReviewIdentity))
    || !object(value.packet) || !same(value.packet.identity, value.identity) || !object(value.impact)) return false;
  const packet = value.packet, extracted = value.impact;
  const revision = (input: unknown) => object(input) && input.baseSha === selected.baseSha && input.headSha === null && input.candidateDigest === selected.candidateDigest;
  if (!object(extracted.graph) || !revision(extracted.graph.revision) || !rows(extracted.graph.nodes, 2000, node => text(node.id, 128))
    || !rows(extracted.graph.edges, 8000) || !strings(extracted.graph.changed, 2000) || !rows(extracted.imports, 1024)
    || !rows(extracted.gaps, 4096, gap => text(gap.kind, 128) && typeof gap.path === 'string' && text(gap.detail))
    || !object(extracted.coverage) || !['extraction', 'semanticResolution', 'executableChecks', 'typescriptVersion'].every(key => text((extracted.coverage as Record<string, unknown>)[key])) || typeof extracted.coverage.complete !== 'boolean'
    || !object(extracted.impact) || !revision(extracted.impact.revision) || extracted.impact.requiresInspection !== true
    || !object(extracted.impact.coverage) || !strings(extracted.impact.coverage.unsupportedLanguages, 64)
    || !['extraction', 'semanticResolution', 'executableChecks'].every(key => text((extracted.impact as Record<string, Record<string, unknown>>).coverage[key]))
    || !rows(extracted.impact.affected, 2000, row => object(row.node) && text(row.node.id, 128))
    || !rows(extracted.impact.edges, 8000) || !rows(extracted.impact.gaps, 8192, gap => text(gap.kind, 128) && text(gap.reference))) return false;
  if (value.verificationConfigured !== undefined && typeof value.verificationConfigured !== 'boolean') return false;
  if (value.dispatchPlan !== undefined && value.dispatchPlan !== null && (!object(value.dispatchPlan) || !['mandatory', 'selected', 'omitted'].every(key => rows((value.dispatchPlan as Record<string, unknown>)[key], 256, row => text(row.id, 128) && strings(row.reasons))))) return false;
  return packet.acceptanceReady === false && packet.candidateCommit === null && digest(packet.packetDigest)
    && rows(packet.requirementCoverage, 128, row => text(row.id, 128) && text(row.criterion) && text(row.status, 128) && strings(row.checkIds, 256) && strings(row.executionIds, 1024)
      && object(row.source) && ['name', 'version', 'url'].every(key => text((row.source as Record<string, unknown>)[key])))
    && object(packet.impact) && text(packet.impact.summary) && strings(packet.impact.nodeIds, 2000) && strings(packet.impact.gaps, 4096)
    && object(packet.tokenSignal) && text(packet.tokenSignal.reason) && Number.isSafeInteger(packet.tokenSignal.observedTokens)
    && rows(packet.reviewerClaims, 8, row => text(row.id, 128) && text(row.reviewer) && rows(row.claims, 100, claim => text(claim.id, 128)
      && text(claim.proposition) && text(claim.verdict, 128) && strings(claim.requirementIds, 128)) && strings(row.claimedExecutions, 100))
    && rows(packet.conflicts, 128, conflict => text(conflict.requirementId, 128) && strings(conflict.claimIds, 1024) && strings(conflict.executionIds, 1024))
    && rows(packet.checkDefinitions, 256, check => text(check.id, 128) && strings(check.requirementIds, 128) && strings(check.nodeIds, 2000)) && object(packet.checkPlan)
    && object(packet.checkPlan.budget) && ['optionalChecks', 'perCheckMs', 'totalMs'].every(key => Number.isSafeInteger((packet.checkPlan as Record<string, Record<string, unknown>>).budget[key]))
    && ['mandatory', 'selected', 'omitted'].every(key => rows((packet.checkPlan as Record<string, unknown>)[key], 256, row => text(row.id, 128) && strings(row.reasons)))
    && rows(packet.executions, 1024, execution => text(execution.id, 128) && text(execution.checkId, 128)) && rows(packet.evidenceReuse, 1024)
    && object(packet.humanInspection) && packet.humanInspection.required === true && strings(packet.humanInspection.reasons)
    && rows(packet.gaps, 8192, gap => text(gap.kind, 128) && text(gap.reference));
}
class InspectionError extends Error {}

export function createCandidateInspection(options: Options = {}) {
  let state = empty();
  let version = 0;
  let active: AbortController | undefined;
  let activeReview: AbortController | undefined;
  let activeVerification: AbortController | undefined;
  const publish = (update: Partial<CandidateInspectionState>) => { state = { ...state, ...update }; options.onChange?.(state); };
  function invalidate() { version++; active?.abort(); activeReview?.abort(); activeVerification?.abort(); }
  function request(path: string, signal: AbortSignal, post = false): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(new InspectionError('Inspection request was cancelled or timed out.'));
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      const work = async () => {
        const response = await (options.fetcher ?? fetch)(path, { signal, credentials: 'same-origin', redirect: 'error', cache: 'no-store',
          ...(post ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}) });
        const data: unknown = await response.json();
        if (!response.ok) throw new InspectionError(object(data) && text(data.message, 512) ? data.message : 'Candidate inspection is unavailable.');
        if (signal.aborted) throw new InspectionError('Inspection request was cancelled or timed out.');
        return data;
      };
      void work().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  const path = (selected: Selection) => `/api/work-items/${encodeURIComponent(selected.itemId)}/candidates/${encodeURIComponent(selected.candidateId)}`;
  function capture() { const { owner, itemId, candidateId, baseSha, candidateDigest } = state; return { owner, itemId, candidateId, baseSha, candidateDigest }; }
  const current = (revision: number, selected: Selection, controller: AbortController) => revision === version && !controller.signal.aborted
    && Object.entries(selected).every(([key, value]) => state[key as keyof Selection] === value);
  async function load(selected: Selection, signal: AbortSignal) {
    const data = await request(`${path(selected)}/assessment`, signal);
    if (!assessment(data, selected)) throw new InspectionError('Assessment does not match the selected revision or is invalid.');
    return data;
  }
  return {
    get state() { return state; },
    async select(owner: string, itemId: string, candidateId: string, baseSha: string, candidateDigest: string): Promise<void> {
      invalidate(); state = empty();
      if (!owner || !itemId || !candidateId) { publish({}); return; }
      if (!uuid(itemId) || !uuid(candidateId) || !sha(baseSha) || !digest(candidateDigest)) { publish({ error: 'Select a valid frozen candidate.' }); return; }
      const selected = { owner, itemId, candidateId, baseSha, candidateDigest }, revision = version;
      active = new AbortController(); const controller = active;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]);
      publish({ ...selected, loading: true });
      try { const data = await load(selected, signal); if (current(revision, selected, controller)) publish({ assessment: data }); }
      catch (cause) { if (current(revision, selected, controller)) publish({ error: cause instanceof InspectionError ? cause.message : 'Candidate assessment is unavailable.' }); }
      finally { if (current(revision, selected, controller)) publish({ loading: false }); }
    },
    async verify(): Promise<void> {
      if (state.verifying || state.reviewing) return;
      if (!state.assessment?.verificationConfigured) { publish({ reviewError: 'Controlled verification is not configured for this frozen repository revision.' }); return; }
      const selected = capture(), revision = version;
      activeVerification = new AbortController(); const controller = activeVerification;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(1_200_000)]);
      publish({ verifying: true, reviewError: '' });
      try {
        const data = await request(`${path(selected)}/assessment/verification`, signal, true);
        if (!current(revision, selected, controller)) return;
        if (!object(data) || !object(data.verification) || !identity(data.verification.identity, selected)
          || !same(data.verification.identity, state.assessment!.identity) || !digest(data.verification.digest)) throw new InspectionError('Verification does not match the selected revision.');
        const refreshed = await load(selected, signal);
        if (current(revision, selected, controller)) publish({ assessment: refreshed });
      } catch (cause) { if (current(revision, selected, controller)) publish({ reviewError: cause instanceof InspectionError ? cause.message : 'Controlled verification is unavailable.' }); }
      finally { if (current(revision, selected, controller)) publish({ verifying: false }); }
    },
    async review(): Promise<void> {
      if (state.reviewing || state.verifying) return;
      if (!state.assessment || !state.assessment.reviewerConfigured || !state.owner) { publish({ reviewError: 'Independent reviewer is not configured or no assessment is selected.' }); return; }
      const selected = capture(), revision = version, identity = state.assessment.identity;
      activeReview = new AbortController(); const controller = activeReview;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]);
      publish({ reviewing: true, reviewError: '' });
      try {
        const data = await request(`${path(selected)}/reviews`, signal, true);
        if (!current(revision, selected, controller)) return;
        if (!object(data) || !storedReview(data.review, selected, identity)) throw new InspectionError('Review does not match the selected revision or is invalid.');
        const stored = data.review;
        const refreshed = await load(selected, signal);
        if (!refreshed.reviews.some(review => review.id === stored.id)) throw new InspectionError('Stored review is unavailable in refreshed assessment.');
        if (current(revision, selected, controller)) publish({ assessment: refreshed });
      } catch (cause) { if (current(revision, selected, controller)) publish({ reviewError: cause instanceof InspectionError ? cause.message : 'Independent review is unavailable.' }); }
      finally { if (current(revision, selected, controller)) publish({ reviewing: false }); }
    },
    stop() { invalidate(); state = empty(); publish({}); }
  };
}
