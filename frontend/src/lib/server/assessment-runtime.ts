import { REVIEWER_API_URL, REVIEWER_API_KEY, REVIEWER_MODEL, REVIEWER_RETENTION_DISCLOSURE, MODAL_API_URL, MODAL_PROXY_TOKEN, MODEL_ID } from '$app/env/private';
import { database } from '#lib/auth.js';
import { githubRuntime } from './intake-runtime.ts';
import { createCandidateRecords } from './candidate-records.ts';
import { createRecords } from './records.ts';
import { createIntake } from './work-items.ts';
import { createGeneration } from './generation.ts';
import { createModelGeneration } from './model-generation.ts';
import { createReviewRecords } from './review-records.ts';
import { createReviewer, reviewerConfigured } from './reviewer.ts';
import { createAssessment } from './assessment.ts';
import { assessmentView } from './assessment-view.ts';
import { whileActive } from './intake.ts';

export async function assessmentRuntime(headers: Headers, owner: string, signal: AbortSignal) {
  const store = createCandidateRecords(database);
  await whileActive(() => store.ready(), signal);
  const github = await githubRuntime(headers, owner, signal);
  const intake = createIntake({ store: createRecords(database), github });
  const configuration = { url: REVIEWER_API_URL, token: REVIEWER_API_KEY, model: REVIEWER_MODEL, retentionDisclosure: REVIEWER_RETENTION_DISCLOSURE };
  const assessment = createAssessment({ intake, github,
    generation: createGeneration({ intake, github, store,
      model: createModelGeneration({ url: MODAL_API_URL, token: MODAL_PROXY_TOKEN, model: MODEL_ID || 'google/gemma-4-31B-it' }) }),
    reviews: createReviewRecords(database), reviewer: createReviewer(configuration) });
  return {
    async load(ownerId: string, itemId: string, candidateId: string, active: AbortSignal) {
      return assessmentView(ownerId, await assessment.load(ownerId, itemId, candidateId, active), reviewerConfigured(configuration));
    },
    review: assessment.review
  };
}
