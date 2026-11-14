import { createHash } from 'node:crypto';
import type { Requirement } from './policy.ts';
import { prioritizeChecks, type PriorityComparison, type VerificationCheck } from './priorities.ts';

export type PacketIdentity = { ownerId: string; itemId: string; candidateId: string; baseSha: string; candidateDigest: string; snapshotDigest: string; policyVersion: string };
export type BoundArtifact<T> = { identity: PacketIdentity; artifactDigest: string; data: T };
export type TrustedCheck = Omit<VerificationCheck, 'missingEvidence' | 'reviewerDisagreement'> & {
  provenance: 'trusted_policy' | 'trusted_repository' | 'owner_defined';
  definitionDigest: string; environmentDigest: string; dependencyDigest: string; oracleDigest: string;
  requirementIds: string[]; nodeIds: string[];
};
export type TrustedExecution = {
  id: string; checkId: string; collector: 'trusted_runner'; runnerId: string; prId: string | null;
  definitionDigest: string; environmentDigest: string; dependencyDigest: string; oracleDigest: string;
  status: 'completed' | 'timed_out' | 'cancelled' | 'infrastructure_error';
  result: 'passed' | 'failed' | 'inconclusive'; exitCode: number | null; executedTests: number;
};
export type PacketReview = { id: string; reviewer: string; claims: Array<{ id: string; requirementIds: string[]; proposition: string; verdict: 'supports' | 'contradicts' | 'uncertain'; nodeIds?: string[]; counterexample?: string | null }>; claimedExecutions: string[] };
export type ReuseAssessment = {
  id: string; executionId: string; sourceIdentity: PacketIdentity; prId: string;
  provenance: 'trusted_coordinator'; unaffected: boolean;
  definitionDigest: string; environmentDigest: string; dependencyDigest: string; oracleDigest: string;
};
export type PacketInput = {
  identity: PacketIdentity;
  policy: BoundArtifact<{ requirements: Requirement[] }>;
  comparison: PriorityComparison;
  impact?: BoundArtifact<{ summary: string; unknown: boolean; nodeIds: string[]; gaps: string[] }>;
  tokenMapping?: BoundArtifact<{ mapping: 'exact' | 'unavailable'; observedTokens: number; reason: string }>;
  reviews?: BoundArtifact<PacketReview>[];
  checks?: BoundArtifact<TrustedCheck>[];
  executions?: BoundArtifact<TrustedExecution>[];
  reuse?: BoundArtifact<ReuseAssessment>[];
  pr?: { id: string | null; isNew: boolean };
};

type Gap = { kind: string; reference: string };
const digestFields = ['definitionDigest', 'environmentDigest', 'dependencyDigest', 'oracleDigest'] as const;
const identityFields = ['ownerId', 'itemId', 'candidateId', 'baseSha', 'candidateDigest', 'snapshotDigest', 'policyVersion'] as const;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function invalid(): never { throw new Error('Invalid review packet.'); }
function text(value: unknown, max = 128): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
    && new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value;
}
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const gitSha = (value: unknown) => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function identity(value: PacketIdentity): PacketIdentity {
  if (!object(value) || Object.keys(value).length !== identityFields.length || !text(value.ownerId)
    || !uuid(value.itemId) || !uuid(value.candidateId) || !gitSha(value.baseSha) || !digest(value.candidateDigest)
    || !digest(value.snapshotDigest) || !text(value.policyVersion)) invalid();
  return { ownerId: value.ownerId, itemId: value.itemId, candidateId: value.candidateId, baseSha: value.baseSha,
    candidateDigest: value.candidateDigest, snapshotDigest: value.snapshotDigest, policyVersion: value.policyVersion };
}
const same = (a: PacketIdentity, b: PacketIdentity) => identityFields.every(key => a[key] === b[key]);
function strings(value: unknown, max = 256, length = 128): asserts value is string[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  for (const row of value) if (!text(row, length)) invalid();
  if (new Set(value).size !== value.length) invalid();
}
function rows<T>(value: T[] | undefined, max: number): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) invalid();
  return Array.from(value);
}
function digests(value: Record<string, unknown>) {
  for (const key of digestFields) if (!digest(value[key])) invalid();
}
const matchingDigests = (a: TrustedCheck, b: TrustedExecution | ReuseAssessment) => digestFields.every(key => a[key] === b[key]);

/** Authenticated coordinator input only: model/browser claims cannot supply trusted checks, runner records or reuse assessments. */
export function buildPacket(authenticatedOwner: string, input: PacketInput) {
  if (!text(authenticatedOwner) || !object(input)) invalid();
  const revision = identity(input.identity);
  if (revision.ownerId !== authenticatedOwner) invalid();
  if (input.pr !== undefined && (!object(input.pr) || typeof input.pr.isNew !== 'boolean'
    || input.pr.id !== null && !text(input.pr.id))) invalid();
  if (!object(input.comparison) || input.comparison.revision !== revision.candidateDigest) invalid();
  const gapMap = new Map<string, Gap>();
  const gap = (kind: string, reference: string) => gapMap.set(`${kind}:${reference}`, { kind, reference });
  function bound<T>(artifact: BoundArtifact<T>, reference: string): boolean {
    if (!object(artifact) || !digest(artifact.artifactDigest) || !object(artifact.data)) invalid();
    const source = identity(artifact.identity);
    if (!same(source, revision)) { gap('stale_artifact', reference); return false; }
    return true;
  }
  function artifact<T>(value: BoundArtifact<T>) {
    if (!object(value) || !digest(value.artifactDigest) || !object(value.data)) invalid();
    identity(value.identity);
  }
  const requirements: Requirement[] = [];
  if (bound(input.policy, 'policy')) {
    const ids = new Set<string>();
    for (const row of rows(input.policy.data.requirements, 100)) {
      if (!object(row) || !text(row.id) || ids.has(row.id) || !text(row.criterion, 8192)
        || !['intent', 'functional', 'non_functional'].includes(row.category)
        || !['trusted_baseline', 'supplied', 'inferred'].includes(row.provenance)
        || typeof row.mandatory !== 'boolean' || row.mandatory && row.provenance !== 'trusted_baseline'
        || row.provenance === 'trusted_baseline' && !row.mandatory
        || !['applicable', 'not_applicable', 'unresolved'].includes(row.applicability)
        || !text(row.reason, 8192) || !text(row.verification, 8192) || row.evidence !== 'unverified'
        || !object(row.source) || !text(row.source.name, 256) || !text(row.source.version)
        || !text(row.source.url, 2048)) invalid();
      ids.add(row.id);
      requirements.push({ id: row.id, category: row.category, criterion: row.criterion, provenance: row.provenance,
        mandatory: row.mandatory, applicability: row.applicability, reason: row.reason, verification: row.verification,
        evidence: 'unverified', source: { name: row.source.name, version: row.source.version, url: row.source.url } });
    }
  }
  requirements.sort((a, b) => compare(a.id, b.id));
  if (!requirements.length) gap('requirements_unavailable', 'policy');
  const requirementIds = new Set(requirements.map(row => row.id));
  let impact = { status: 'unavailable' as 'available' | 'unavailable', summary: 'Impact analysis is unavailable.', unknown: true, nodeIds: [] as string[], gaps: [] as string[] };
  if (input.impact && bound(input.impact, 'impact')) {
    const value = input.impact.data;
    if (!text(value.summary, 8192) || typeof value.unknown !== 'boolean') invalid();
    // Retain provenance gaps for up to 1024 import references across 24 supplied files.
    strings(value.nodeIds, 2000); strings(value.gaps, 4096, 1024);
    impact = { status: 'available', summary: value.summary, unknown: value.unknown || value.gaps.length > 0,
      nodeIds: [...value.nodeIds].sort(compare), gaps: [...value.gaps].sort(compare) };
  }
  if (impact.unknown) gap('impact_unknown', 'impact');
  for (const reference of impact.gaps) gap('impact_gap', reference);
  let tokenSignal = { mapping: 'unavailable' as 'exact' | 'unavailable', observedTokens: 0, reason: 'Exact token-to-content mapping is unavailable; token observations are not correctness evidence.' };
  if (input.tokenMapping && bound(input.tokenMapping, 'token_mapping')) {
    const value = input.tokenMapping.data;
    if (!['exact', 'unavailable'].includes(value.mapping) || !Number.isSafeInteger(value.observedTokens)
      || value.observedTokens < 0 || value.observedTokens > 8192 || value.mapping === 'exact' && value.observedTokens === 0 || !text(value.reason, 1024)) invalid();
    tokenSignal = { mapping: value.mapping, observedTokens: value.observedTokens, reason: value.reason };
  }
  if (tokenSignal.mapping !== 'exact') gap('token_mapping_unavailable', 'generation');
  const reviewerClaims: Array<PacketReview & { artifactDigest: string }> = [];
  const reviewIds = new Set<string>();
  for (const review of rows(input.reviews, 8)) {
    if (!bound(review, 'review')) continue;
    const value = review.data;
    if (!text(value.id) || reviewIds.has(value.id) || !text(value.reviewer)) invalid();
    reviewIds.add(value.id);
    strings(value.claimedExecutions, 100, 8192);
    const claimIds = new Set<string>();
    const claims = rows(value.claims, 100).map(claim => {
      if (!object(claim) || !text(claim.id) || claimIds.has(claim.id) || !text(claim.proposition, 8192)
        || !['supports', 'contradicts', 'uncertain'].includes(claim.verdict)) invalid();
      claimIds.add(claim.id); strings(claim.requirementIds, 100);
      const nodeIds = claim.nodeIds ?? []; strings(nodeIds, 256);
      if (claim.counterexample !== undefined && claim.counterexample !== null && !text(claim.counterexample, 8192)) invalid();
      for (const id of nodeIds) if (!impact.nodeIds.includes(id)) {
        impact.unknown = true; gap('claim_impact_unresolved', `${value.id}:${claim.id}:${id}`); gap('impact_unknown', 'impact');
      }
      for (const id of claim.requirementIds) if (!requirementIds.has(id)) gap('unknown_claim_requirement', `${value.id}:${id}`);
      return { id: claim.id, proposition: claim.proposition, verdict: claim.verdict, requirementIds: [...claim.requirementIds].sort(compare),
        nodeIds: [...nodeIds].sort(compare), counterexample: claim.counterexample ?? null };
    }).sort((a, b) => compare(a.id, b.id));
    reviewerClaims.push({ id: value.id, reviewer: value.reviewer, claims, claimedExecutions: [...value.claimedExecutions].sort(compare), artifactDigest: review.artifactDigest });
    if (value.claimedExecutions.length) gap('reviewer_execution_claim_unverified', value.id);
  }
  reviewerClaims.sort((a, b) => compare(a.id, b.id));
  if (!reviewerClaims.length) gap('reviewer_unavailable', 'review');
  const checks = new Map<string, TrustedCheck>();
  for (const supplied of rows(input.checks, 256)) {
    if (!bound(supplied, 'check')) continue;
    const value = supplied.data;
    if (!text(value.id) || checks.has(value.id) || !['trusted_policy', 'trusted_repository', 'owner_defined'].includes(value.provenance)
      || typeof value.mandatory !== 'boolean' || !['critical', 'high', 'medium', 'low', 'unknown'].includes(value.impact)
      || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 3_600_000) invalid();
    digests(value); strings(value.requirementIds, 100); strings(value.nodeIds, 2000);
    if (!value.requirementIds.length || value.requirementIds.some(id => !requirementIds.has(id))) { gap('check_requirement_unavailable', value.id); continue; }
    if (value.nodeIds.some(id => !impact.nodeIds.includes(id))) {
      impact.unknown = true; gap('check_impact_unresolved', value.id); gap('impact_unknown', 'impact');
    }
    const mandatory = value.mandatory || requirements.some(row => row.mandatory && value.requirementIds.includes(row.id) && row.applicability !== 'not_applicable');
    checks.set(value.id, { id: value.id, provenance: value.provenance, definitionDigest: value.definitionDigest,
      environmentDigest: value.environmentDigest, dependencyDigest: value.dependencyDigest, oracleDigest: value.oracleDigest,
      requirementIds: [...value.requirementIds].sort(compare), nodeIds: [...value.nodeIds].sort(compare), mandatory,
      impact: impact.unknown ? 'unknown' : value.impact, timeoutMs: value.timeoutMs,
      ...(tokenSignal.mapping === 'exact' && value.signal ? { signal: value.signal } : {}) });
  }
  if (impact.unknown) for (const definition of checks.values()) definition.impact = 'unknown';
  const reuse = rows(input.reuse, 256);
  const reuseIds = new Set<string>();
  const assessedExecutions = new Set<string>();
  for (const assessment of reuse) {
    artifact(assessment);
    const value = assessment.data;
    if (!text(value.id) || reuseIds.has(value.id) || !text(value.executionId) || !text(value.prId)
      || value.provenance !== 'trusted_coordinator' || typeof value.unaffected !== 'boolean') invalid();
    identity(value.sourceIdentity); digests(value); reuseIds.add(value.id);
    if (same(assessment.identity, revision)) {
      if (assessedExecutions.has(value.executionId)) invalid();
      assessedExecutions.add(value.executionId);
    }
  }
  const executions: Array<TrustedExecution & { artifactDigest: string; evidenceStatus: 'current' | 'reused' | 'stale' | 'unavailable'; identity: PacketIdentity }> = [];
  const evidenceReuse: Array<{ executionId: string; status: 'reused' | 'denied'; assessmentId: string | null; assessmentDigest: string | null; reason: string }> = [];
  const executionIds = new Set<string>();
  for (const supplied of rows(input.executions, 512)) {
    artifact(supplied);
    if (supplied.identity.ownerId !== authenticatedOwner) { gap('stale_artifact', 'execution_owner'); continue; }
    const value = supplied.data;
    if (!text(value.id) || executionIds.has(value.id) || !text(value.checkId) || !text(value.runnerId)
      || value.collector !== 'trusted_runner' || value.prId !== null && !text(value.prId)
      || !['completed', 'timed_out', 'cancelled', 'infrastructure_error'].includes(value.status)
      || !['passed', 'failed', 'inconclusive'].includes(value.result)
      || !Number.isSafeInteger(value.executedTests) || value.executedTests < 0 || value.executedTests > 1_000_000
      || value.exitCode !== null && (!Number.isSafeInteger(value.exitCode) || Math.abs(value.exitCode) > 255)) invalid();
    executionIds.add(value.id); digests(value);
    const definition = checks.get(value.checkId);
    const current = same(supplied.identity, revision) && value.prId === (input.pr?.id ?? null);
    const assessment = reuse.find(record => same(record.identity, revision) && record.data.executionId === value.id
      && same(record.data.sourceIdentity, supplied.identity));
    const interpreted = value.status === 'completed' && value.executedTests > 0 && value.exitCode !== null
      && value.result !== 'inconclusive' && (value.result !== 'passed' || value.exitCode === 0);
    const reusable = interpreted && !current && definition && !impact.unknown && assessment && assessment.data.unaffected
      && input.pr?.id && input.pr.isNew === false && input.pr.id === value.prId && input.pr.id === assessment.data.prId
      && ['ownerId', 'itemId', 'baseSha', 'snapshotDigest', 'policyVersion'].every(key => supplied.identity[key as keyof PacketIdentity] === revision[key as keyof PacketIdentity])
      && matchingDigests(definition, assessment.data) && matchingDigests(definition, value);
    if (!current) evidenceReuse.push({ executionId: value.id, status: reusable ? 'reused' : 'denied',
      assessmentId: assessment?.data.id ?? null, assessmentDigest: assessment?.artifactDigest ?? null,
      reason: reusable ? 'Exact inputs and explicit same-PR assessment match.'
        : !interpreted ? 'Execution has no completed interpreted behavioral result.'
        : impact.unknown ? 'Unknown impact requires fresh mandatory verification.'
        : !input.pr?.id || input.pr.isNew ? 'New or unpublished PRs cannot reuse verification.'
        : !assessment ? 'No matching revision-bound reuse assessment.'
        : 'PR, source dependencies, snapshot, policy, definition, oracle or environment changed.' });
    let evidenceStatus: 'current' | 'reused' | 'stale' | 'unavailable' = current ? 'current' : reusable ? 'reused' : 'stale';
    if (!definition || !matchingDigests(definition, value) || !interpreted) evidenceStatus = 'unavailable';
    if (!current && !reusable) gap('stale_artifact', `execution:${value.id}`);
    if (evidenceStatus === 'unavailable') gap('execution_unavailable', value.id);
    executions.push({ id: value.id, checkId: value.checkId, collector: 'trusted_runner', runnerId: value.runnerId,
      prId: value.prId, definitionDigest: value.definitionDigest, environmentDigest: value.environmentDigest,
      dependencyDigest: value.dependencyDigest, oracleDigest: value.oracleDigest, status: value.status, result: value.result,
      exitCode: value.exitCode, executedTests: value.executedTests, artifactDigest: supplied.artifactDigest,
      evidenceStatus, identity: identity(supplied.identity) });
  }
  for (const assessment of reuse) if (same(assessment.identity, revision) && !executionIds.has(assessment.data.executionId)) gap('reuse_execution_missing', assessment.data.id);
  executions.sort((a, b) => compare(a.id, b.id)); evidenceReuse.sort((a, b) => compare(a.executionId, b.executionId));
  const effective = (checkId: string) => executions.filter(row => row.checkId === checkId && ['current', 'reused'].includes(row.evidenceStatus));
  const conflicts: Array<{ requirementId: string; claimIds: string[]; executionIds: string[] }> = [];
  for (const requirement of requirements) {
    const claims = reviewerClaims.flatMap(review => review.claims.filter(row => row.requirementIds.includes(requirement.id)).map(row => ({ ...row, reference: `${review.id}:${row.id}` })));
    const failures = executions.filter(row => ['current', 'reused'].includes(row.evidenceStatus) && row.result === 'failed' && checks.get(row.checkId)?.requirementIds.includes(requirement.id));
    if (claims.some(row => row.verdict === 'supports') && (claims.some(row => row.verdict === 'contradicts') || failures.length)) {
      conflicts.push({ requirementId: requirement.id, claimIds: claims.map(row => row.reference).sort(compare), executionIds: failures.map(row => row.id).sort(compare) });
      gap('conflicting_evidence', requirement.id);
    }
  }
  const checkPlan = prioritizeChecks([...checks.values()].map(row => ({ ...row,
    missingEvidence: effective(row.id).length === 0,
    reviewerDisagreement: conflicts.some(conflict => row.requirementIds.includes(conflict.requirementId))
  })), { model: input.comparison.model, settingsDigest: input.comparison.settingsDigest, revision: input.comparison.revision });
  for (const row of [...checkPlan.mandatory, ...checkPlan.selected]) if (row.missingEvidence) gap('missing_execution', row.id);
  for (const row of checkPlan.omitted) gap('optional_check_omitted', row.id);
  const requirementCoverage = requirements.map(requirement => {
    const relevant = [...checks.values()].filter(row => row.requirementIds.includes(requirement.id));
    const evidence = relevant.flatMap(row => effective(row.id));
    const status = requirement.applicability === 'not_applicable' ? 'not_applicable' as const
      : evidence.some(row => row.result === 'failed') ? 'failed' as const
      : requirement.applicability === 'applicable' && relevant.length > 0
        && relevant.every(row => effective(row.id).some(execution => execution.result === 'passed')) ? 'passed_exercised_checks' as const : 'unavailable' as const;
    if (requirement.mandatory && status !== 'passed_exercised_checks' && status !== 'not_applicable') gap('mandatory_requirement_inspection', requirement.id);
    if (!relevant.length && requirement.applicability !== 'not_applicable') gap('missing_check', requirement.id);
    return { ...requirement, status, checkIds: relevant.map(row => row.id).sort(compare), executionIds: evidence.map(row => row.id).sort(compare), inspection: status !== 'not_applicable' };
  });
  const checkDefinitions = [...checks.values()].map(({ signal: _signal, ...definition }) => definition).sort((a, b) => compare(a.id, b.id));
  const gaps = [...gapMap.values()].sort((a, b) => compare(a.kind, b.kind) || compare(a.reference, b.reference));
  const verification = { status: executions.some(row => ['current', 'reused'].includes(row.evidenceStatus)) ? 'recorded' as const : 'unavailable' as const,
    mandatoryRerunRequired: impact.unknown && requirementCoverage.some(row => row.mandatory && !['passed_exercised_checks', 'not_applicable'].includes(row.status)) };
  const packet = { identity: revision, candidateCommit: null, acceptanceReady: false as const,
    requirementCoverage, impact, tokenSignal, reviewerClaims, conflicts, checkDefinitions, checkPlan, verification, executions, evidenceReuse,
    humanInspection: { required: true as const, reasons: ['A named human must inspect the frozen revision and its evidence gaps.'] }, gaps };
  if (Buffer.byteLength(JSON.stringify(packet)) > 2_097_152) invalid();
  return { ...packet, packetDigest: createHash('sha256').update(JSON.stringify(packet)).digest('hex') };
}
