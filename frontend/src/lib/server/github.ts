export type GitHubAccount = { id: string; userId: string; providerId: string; accountId: string };

export function githubAccount(accounts: GitHubAccount[], owner: string): GitHubAccount {
  const linked = accounts.filter((account) => account.userId === owner && account.providerId === 'github');
  if (linked.length !== 1) throw new Error('Sign in with one linked GitHub account before selecting an issue.');
  return linked[0];
}

import { createSign } from 'node:crypto';
import { IntakeError, readJson } from './intake.ts';
import type { IssueSnapshot } from './intake.ts';

type Options = { appId: string; privateKey: string; userToken: string; accountId: string; fetcher?: typeof fetch };
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IntakeError(502, 'GitHub returned an invalid response.');
  return value as ObjectValue;
}
function id(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new IntakeError(502, 'GitHub returned an invalid identifier.');
  return Number(value);
}
function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > limit) throw new IntakeError(502, 'GitHub returned invalid or oversized content.');
  return value;
}
function jwt(appId: string, key: string): string {
  const now = Math.floor(Date.now() / 1000);
  const data = [ { alg: 'RS256', typ: 'JWT' }, { iat: now - 60, exp: now + 540, iss: appId } ]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${data}.${createSign('RSA-SHA256').update(data).sign(key).toString('base64url')}`;
}

export function createGitHub(options: Options) {
  async function request(path: string, token: string, signal: AbortSignal, body?: unknown): Promise<ObjectValue> {
    try {
      signal.throwIfAborted();
      const response = await (options.fetcher ?? fetch)(`https://api.github.com${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new IntakeError([401,403,404].includes(response.status) ? 403 : 502, 'GitHub access is unavailable or no longer authorized.');
      }
      return object(await readJson(response, 1024 * 1024));
    } catch (cause) {
      if (cause instanceof IntakeError && cause.status === 403) throw cause;
      throw new IntakeError(502, 'GitHub did not complete a valid bounded request.');
    }
  }

  async function authorize(repository: string, signal: AbortSignal, expectedId?: number) {
    const user = await request('/user', options.userToken, signal);
    if (String(id(user.id)) !== options.accountId) throw new IntakeError(403, 'The linked GitHub identity could not be verified.');
    const repo = await request(`/repos/${repository}`, options.userToken, signal);
    const repositoryId = id(repo.id);
    if (expectedId !== undefined && repositoryId !== expectedId) throw new IntakeError(403, 'Repository identity has changed.');
    const appJwt = jwt(options.appId, options.privateKey);
    const installation = await request(`/repos/${repository}/installation`, appJwt, signal);
    if (String(id(installation.app_id)) !== options.appId || installation.suspended_at !== null) throw new IntakeError(403, 'The GitHub App installation is unavailable.');
    const access = await request(`/app/installations/${id(installation.id)}/access_tokens`, appJwt, signal,
      { repository_ids: [repositoryId], permissions: { contents: 'read', issues: 'read' } });
    const token = text(access.token, 4096);
    const installedRepo = await request(`/repos/${repository}`, token, signal);
    if (id(installedRepo.id) !== repositoryId) throw new IntakeError(403, 'Repository authorization does not match.');
    const canonical = text(installedRepo.full_name, 201);
    if (canonical.toLowerCase() !== repository.toLowerCase() || typeof installedRepo.private !== 'boolean') throw new IntakeError(502, 'GitHub returned invalid repository metadata.');
    return { repositoryId, repository: canonical, private: installedRepo.private, branch: text(installedRepo.default_branch, 255), token };
  }

  return {
    authorize: async (repository: string, repositoryId: number, signal: AbortSignal) => { await authorize(repository, signal, repositoryId); },
    snapshot: async (repository: string, number: number, signal: AbortSignal): Promise<IssueSnapshot> => {
      const repo = await authorize(repository, signal);
      const issue = await request(`/repos/${repo.repository}/issues/${number}`, repo.token, signal);
      if ('pull_request' in issue || id(issue.number) !== number) throw new IntakeError(400, 'Select a GitHub issue rather than a pull request.');
      const commit = await request(`/repos/${repo.repository}/commits/${encodeURIComponent(repo.branch)}`, repo.token, signal);
      const baseSha = text(commit.sha, 64);
      if (!/^[a-f0-9]{40,64}$/.test(baseSha)) throw new IntakeError(502, 'GitHub did not return a commit identity.');
      return { repositoryId: repo.repositoryId, repository: repo.repository, private: repo.private,
        issueNumber: number, issueId: id(issue.id), baseSha,
        supplied: { title: text(issue.title, 4096), body: issue.body === null ? '' : text(issue.body, 128 * 1024), provenance: 'supplied' },
        inferred: [], ownerConfirmed: [] };
    }
  };
}
