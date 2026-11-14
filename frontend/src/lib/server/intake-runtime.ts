import { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY } from '$app/env/private';
import { auth, database } from '#lib/auth.js';
import { createGitHub, githubAccount } from './github.ts';
import { IntakeError } from './intake.ts';
import { createRecords } from './records.ts';
import { createIntake } from './work-items.ts';

export async function intakeRuntime(headers: Headers, owner: string) {
  if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY || !/^[1-9]\d*$/.test(GITHUB_APP_ID)) {
    throw new IntakeError(503, 'GitHub issue intake requires a configured GitHub App installation.');
  }
  const accounts = await auth.api.listUserAccounts({ headers });
  let account;
  try { account = githubAccount(accounts, owner); }
  catch { throw new IntakeError(403, 'Sign in with one linked GitHub account before selecting an issue.'); }
  const token = await auth.api.getAccessToken({ headers, body: { accountId: account.id } });
  if (!token.accessToken) throw new IntakeError(403, 'Reconnect GitHub before selecting an issue.');
  const github = createGitHub({ appId: GITHUB_APP_ID, privateKey: GITHUB_APP_PRIVATE_KEY, userToken: token.accessToken, accountId: account.accountId });
  return createIntake({ store: createRecords(database), github });
}
