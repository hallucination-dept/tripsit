import { REVIEWER_API_URL, REVIEWER_API_KEY, REVIEWER_MODEL, REVIEWER_RETENTION_DISCLOSURE, RUNNER_API_URL, RUNNER_API_KEY, TRUSTED_CHECKS_JSON, REQUIRED_CHECK_MANIFEST_JSON } from '$app/env/private';
import { database } from '#lib/auth.js';
import { createExactRevision } from './exact-revision.ts';
import { createVerification, verificationConfigured, mandatoryInventory } from './verification.ts';
import { trustedRequiredManifest } from './trusted-required-manifest.ts';
import { createVerificationRecords } from './verification-records.ts';
import { verificationContext, type Assessment } from './assessment.ts';
import { createAssessment } from './assessment.ts';
import { candidateServices } from './generation-runtime.ts';
import { createReviewRecords } from './review-records.ts';
import { createReviewer, reviewerConfigured as isReviewerConfigured } from './reviewer.ts';

export async function assessmentRuntime(headers: Headers, owner: string, signal: AbortSignal) {
  const services = await candidateServices(headers, owner, signal);
  const configuration = { url: REVIEWER_API_URL, token: REVIEWER_API_KEY, model: REVIEWER_MODEL, retentionDisclosure: REVIEWER_RETENTION_DISCLOSURE };
  const reviewerConfigured = isReviewerConfigured(configuration);
  const reviewer = createReviewer(reviewerConfigured ? configuration : {});
  const verificationConfiguration = { url: RUNNER_API_URL, token: RUNNER_API_KEY, manifest: TRUSTED_CHECKS_JSON };
  return { requiredManifest: (assessment: Assessment) => trustedRequiredManifest(REQUIRED_CHECK_MANIFEST_JSON, TRUSTED_CHECKS_JSON, verificationContext(assessment), assessment.policy.requirements), github: services.github, intake: services.intake, generation: services.generation, verificationAvailable: (assessment: Assessment) => verificationConfigured(verificationConfiguration, verificationContext(assessment)), mandatoryInventory: (assessment: Assessment) => mandatoryInventory(verificationConfiguration, verificationContext(assessment), assessment.policy.requirements), service: createAssessment({ ...services, exactRevision: createExactRevision(database, services.github, services.intake, services.generation), reviews: createReviewRecords(database), reviewer, verification: createVerification(verificationConfiguration), verificationRecords: createVerificationRecords(database) }), reviewerConfigured };
}
