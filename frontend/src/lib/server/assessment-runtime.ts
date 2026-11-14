import { REVIEWER_API_URL, REVIEWER_API_KEY, REVIEWER_MODEL, REVIEWER_RETENTION_DISCLOSURE, RUNNER_API_URL, RUNNER_API_KEY, TRUSTED_CHECKS_JSON } from '$app/env/private';
import { database } from '#lib/auth.js';
import { createVerification, verificationConfigured } from './verification.ts';
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
  return { verificationAvailable: (assessment: Assessment) => verificationConfigured(verificationConfiguration, verificationContext(assessment)), service: createAssessment({ ...services, reviews: createReviewRecords(database), reviewer, verification: createVerification(verificationConfiguration), verificationRecords: createVerificationRecords(database) }), reviewerConfigured };
}
