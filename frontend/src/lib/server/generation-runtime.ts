import { MODAL_API_URL, MODAL_PROXY_TOKEN, MODEL_ID } from '$app/env/private';
import { database } from '#lib/auth.js';
import { githubRuntime } from './intake-runtime.ts';
import { createCandidateRecords } from './candidate-records.ts';
import { createGeneration } from './generation.ts';
import { createModelGeneration } from './model-generation.ts';
import { createRecords } from './records.ts';
import { createIntake } from './work-items.ts';
import { whileActive } from './intake.ts';

export async function candidateRuntime(headers: Headers, owner: string, signal: AbortSignal) {
  const store = createCandidateRecords(database);
  await whileActive(() => store.ready(), signal);
  const github = await githubRuntime(headers, owner, signal);
  return createGeneration({
    intake: createIntake({ store: createRecords(database), github }),
    github,
    model: createModelGeneration({ url: MODAL_API_URL, token: MODAL_PROXY_TOKEN, model: MODEL_ID || 'google/gemma-4-31B-it' }),
    store
  });
}
