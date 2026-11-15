import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createReviewer, reviewerConfigured, type ReviewerInput } from '../src/lib/server/reviewer.ts';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const original = 'export function divide(a: number, b: number): number | null { return b === 0 ? null : a / b; }\n';
const replacement = 'export function divide(a: number, b: number): number | null { return a / b; }\n';
const fixture: ReviewerInput = {
  baseSha: createHash('sha1').update(original).digest('hex'), candidateDigest: digest(replacement), private: false,
  requirements: [{ id: 'R1', criterion: 'divide must return null when the divisor is zero.', provenance: 'supplied', mandatory: true }],
  nodes: [{ id: 'N1', path: 'divide.ts' }], files: [{ path: 'divide.ts', original, replacement }],
  issue: { title: 'Preserve zero-divisor behavior', body: 'Review the replacement against R1. This is a synthetic public fixture.' }
};

/** Provider contract only: this does not certify authenticated UAT, execution or private admission. */
export async function reviewerGate(environment: Record<string, string | undefined>, signal: AbortSignal, fetcher?: typeof fetch) {
  const configuration = { url: environment.REVIEWER_API_URL, token: environment.REVIEWER_API_KEY,
    model: environment.REVIEWER_MODEL, retentionDisclosure: environment.REVIEWER_RETENTION_DISCLOSURE, fetcher };
  const report = { status: 'failed', scope: 'public_synthetic_provider_contract', authenticatedOwnerUat: 'unverified', privateAdmission: 'unverified',
    fixtureDigest: digest(fixture), configurationDigest: digest([configuration.url, configuration.token, configuration.model, configuration.retentionDisclosure]),
    claimCount: 0, checkCount: 0, promptDigest: '', responseDigest: '' };
  if (!reviewerConfigured(configuration)) return report;
  const result = await createReviewer(configuration).review(fixture, signal);
  if (result.status !== 'completed') return report;
  // Empty/unlinked proposals do not demonstrate the requirement-and-node contract.
  if (!result.claims.some(claim => claim.requirementIds.includes('R1') && claim.nodeIds.includes('N1'))
    || !result.checks.some(check => check.requirementIds.includes('R1') && check.nodeIds.includes('N1'))) return report;
  return { ...report, status: 'passed_configured_reviewer', claimCount: result.claims.length, checkCount: result.checks.length,
    promptDigest: result.promptDigest, responseDigest: result.responseDigest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await reviewerGate(process.env, AbortSignal.timeout(65_000)).catch(() => ({ status: 'failed', scope: 'public_synthetic_provider_contract' }));
  console.log(JSON.stringify(result));
  process.exitCode = result.status === 'passed_configured_reviewer' ? 0 : 1;
}
