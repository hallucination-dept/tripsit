import { createHash } from 'node:crypto';
import type { Assessment } from './assessment.ts';
import { IntakeError } from './intake.ts';
import { buildPacket, type BoundArtifact, type PacketIdentity, type PacketReview } from './packet.ts';

const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const canonical = (value: unknown) => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort(compare).map(key => [key, entry[key]])) : entry);
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

export function assessmentView(owner: string, assessment: Assessment, reviewerConfigured: boolean, verificationConfigured = false) {
  if (!owner || assessment.identity.ownerId !== owner || assessment.reviews.some(review => review.identity.ownerId !== owner)) {
    throw new IntakeError(404, 'Assessment is unavailable.');
  }
  const identity = { ...assessment.identity };
  const bound = <T>(data: T, source: unknown = data, sourceIdentity: PacketIdentity = identity): BoundArtifact<T> => ({ identity: { ...sourceIdentity }, artifactDigest: digest(source), data });
  const reviews = [...assessment.reviews].sort((left, right) => compare(left.createdAt, right.createdAt) || compare(left.id, right.id));
  const proposals: BoundArtifact<PacketReview>[] = reviews.flatMap(review => review.result.status === 'completed' ? [{
    identity: { ...review.identity }, artifactDigest: review.digest,
    data: { id: review.id, reviewer: review.result.model, claimedExecutions: [],
      claims: review.result.claims.map(claim => ({ id: claim.id, requirementIds: [...claim.requirementIds], nodeIds: [...claim.nodeIds],
        proposition: claim.statement, verdict: claim.stance, counterexample: claim.counterexample })) }
  }] : []);
  const impact = assessment.impact;
  if (impact.graph.revision.headSha !== null) throw new IntakeError(409, 'Assessment revision is unavailable.');
  const impactIdentity = { ...identity, baseSha: impact.graph.revision.baseSha, candidateDigest: impact.graph.revision.candidateDigest };
  const gapReferences = [...new Set([
    ...impact.gaps.map(gap => `${gap.kind}:${digest(gap)}`),
    ...impact.impact.gaps.map(gap => `${gap.kind}:${gap.reference}`)
  ])].sort(compare);
  const verifications = assessment.verifications ?? [];
  if (verifications.some(record => record.identity.ownerId !== owner)) throw new IntakeError(404, 'Assessment is unavailable.');
  const latest = [...verifications].reverse().find(record => Object.entries(identity).every(([key, value]) => record.identity[key as keyof PacketIdentity] === value));
  const definitions = latest?.result.checks.map(check => bound(check, check, latest.identity)) ?? [];
  const executions = verifications.flatMap(record => record.result.executions.map(execution => bound(execution, execution, record.identity)));
  const signal = assessment.generation.tokenSignal;
  const exact = signal?.mapping.status === 'exact' && signal.mapping.outputDigest === identity.candidateDigest
    && signal.mapping.model === assessment.generation.model && signal.mapping.settingsDigest === assessment.generation.settingsDigest
    && signal.observations.status === 'observed' && signal.observations.tokens.length > 0
    && signal.observations.tokens.length === assessment.generation.observedTokens
    && signal.mapping.observationsDigest === createHash('sha256').update(JSON.stringify(signal.observations)).digest('hex');
  const packet = buildPacket(owner, {
    identity,
    policy: bound({ requirements: assessment.policy.requirements }, assessment.policy, { ...identity, policyVersion: assessment.policy.version }),
    comparison: { model: assessment.generation.model, settingsDigest: assessment.generation.settingsDigest, revision: identity.candidateDigest },
    impact: bound({ summary: `${impact.impact.affected.length} affected nodes across ${impact.graph.nodes.length} supplied graph nodes. Semantic relationships and executable checks remain unverified.`,
      unknown: true, nodeIds: impact.graph.nodes.map(node => node.id).sort(compare), gaps: gapReferences }, impact, impactIdentity),
    tokenMapping: bound({ mapping: exact ? 'exact' : 'unavailable', observedTokens: assessment.generation.observedTokens,
      reason: exact ? 'Exact response-to-file byte mapping is available. Individual checks may still lack comparable coverage.' : 'Exact token mapping is unavailable for this revision.' }, assessment.generation),
    reviews: proposals, checks: definitions, executions, reuse: [], pr: { id: null, isNew: true }
  });
  const currentReviews = reviews.filter(review => Object.entries(identity).every(([key, value]) => review.identity[key as keyof PacketIdentity] === value));
  return { identity, impact, packet, reviews: currentReviews, reviewerConfigured, verificationConfigured, dispatchPlan: latest?.result.dispatchPlan ?? null };
}
