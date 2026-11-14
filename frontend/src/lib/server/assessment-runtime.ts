import { REVIEWER_API_URL, REVIEWER_API_KEY, REVIEWER_MODEL, REVIEWER_RETENTION_DISCLOSURE } from '$app/env/private';
import { database } from '#lib/auth.js';
import { createAssessment } from './assessment.ts';
import { candidateServices } from './generation-runtime.ts';
import { createReviewRecords } from './review-records.ts';
import { createReviewer } from './reviewer.ts';

export async function assessmentRuntime(headers: Headers, owner: string, signal: AbortSignal) {
  const services = await candidateServices(headers, owner, signal);
  const reviewerConfigured = [REVIEWER_API_URL, REVIEWER_API_KEY, REVIEWER_MODEL, REVIEWER_RETENTION_DISCLOSURE].every(Boolean);
  const reviewer = createReviewer(reviewerConfigured ? { url: REVIEWER_API_URL, token: REVIEWER_API_KEY,
    model: REVIEWER_MODEL, retentionDisclosure: REVIEWER_RETENTION_DISCLOSURE } : {});
  return { service: createAssessment({ ...services, reviews: createReviewRecords(database), reviewer }), reviewerConfigured };
}
