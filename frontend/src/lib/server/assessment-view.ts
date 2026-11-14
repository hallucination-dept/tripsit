import { createHash } from 'node:crypto';
import type { Assessment } from './assessment.ts';
import { buildPacket, type BoundArtifact } from './packet.ts';

export function assessmentView(owner: string, assessment: Assessment, reviewerConfigured: boolean) {
  const { identity, impact, reviews, generation } = assessment;
  const bound = <T>(data: T): BoundArtifact<T> => ({ identity, data, artifactDigest: createHash('sha256').update(JSON.stringify(data)).digest('hex') });
  const impactGaps = [...new Set([
    ...impact.gaps.map(gap => `${gap.kind}:${createHash('sha256').update(JSON.stringify(gap)).digest('hex')}`),
    ...impact.impact.gaps.map(gap => `${gap.kind}:${createHash('sha256').update(JSON.stringify(gap)).digest('hex')}`)
  ])];
  const packet = buildPacket(owner, {
    identity,
    policy: bound({ requirements: assessment.policy.requirements }),
    comparison: { model: generation.model, settingsDigest: generation.settingsDigest, revision: identity.candidateDigest },
    impact: bound({ summary: 'Static JS/TS file imports and reverse dependencies; semantic resolution and executable verification remain unavailable.',
      unknown: true, nodeIds: impact.graph.nodes.map(node => node.id),
      gaps: impactGaps.length <= 512 ? impactGaps : [...impactGaps.slice(0, 511), `additional_impact_gaps:${impactGaps.length - 511}`] }),
    tokenMapping: bound({ mapping: generation.mapping.status, observedTokens: generation.observedTokens, reason: generation.mapping.reason }),
    reviews: reviews.flatMap(review => review.result.status === 'completed' ? [bound({
      id: review.id, reviewer: review.result.model,
      claims: review.result.claims.map(claim => ({ id: claim.id, requirementIds: claim.requirementIds, nodeIds: claim.nodeIds,
        proposition: claim.statement, verdict: claim.stance, counterexample: claim.counterexample })), claimedExecutions: []
    })] : [])
  });
  return { identity, impact, packet, reviews, reviewerConfigured };
}
