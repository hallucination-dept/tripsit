import { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY } from '$app/env/private';
import { auth, database } from '#lib/auth.js';
import { createGitHub, linkedGitHubToken } from './github.ts';
import { IntakeError } from './intake.ts';
import { createRecords } from './records.ts';
import { createIntake } from './work-items.ts';

export async function githubRuntime(headers: Headers, owner: string, signal: AbortSignal) {
  if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY || !/^[1-9]\d*$/.test(GITHUB_APP_ID)) {
    throw new IntakeError(503, 'GitHub issue intake requires a configured GitHub App installation.');
  }
  const token = await linkedGitHubToken(auth.api, headers, owner, signal);
  signal.throwIfAborted();
  return createGitHub({ appId: GITHUB_APP_ID, privateKey: GITHUB_APP_PRIVATE_KEY, ...token });
}

export async function intakeRuntime(headers: Headers, owner: string, signal: AbortSignal) {
  return createIntake({ store: createRecords(database), github: await githubRuntime(headers, owner, signal) });
}
