import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { createGitHub, type PullRequest } from '../src/lib/server/github.ts';
import { IntakeError } from '../src/lib/server/intake.ts';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const head = 'e'.repeat(40), merged = 'f'.repeat(40);
const pull: PullRequest = { number: 12, url: 'https://github.com/team/repo/pull/12', branch: 'tripsit/0123abcd' };
type Reply = { status: number; body?: unknown };

// A fake GitHub: repository authorization as in agent-publish.test.ts, plus scripted pull request answers.
function github(options: { push?: boolean; state?: Record<string, unknown>; merges?: Reply[]; close?: Reply } = {}) {
  const calls: { method: string; path: string; token: string; body: Record<string, unknown> | null }[] = [];
  const merges = [...(options.merges ?? [{ status: 200, body: { merged: true, sha: merged } }])];
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path, token: new Headers(init?.headers).get('Authorization') ?? '', body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (path === '/user') return json({ id: 42 });
    if (path === '/repos/team/repo') return json({ id: 5, full_name: 'team/repo', private: true, default_branch: 'main', permissions: { push: options.push ?? true } });
    if (path === '/repos/team/repo/installation') return json({ id: 7, app_id: 9, suspended_at: null });
    if (path === '/app/installations/7/access_tokens') return json({ token: 'read-token' });
    if (path === '/repos/team/repo/pulls/12' && method === 'GET') return json({ state: 'open', merged: false, head: { ref: pull.branch, sha: head }, ...options.state });
    if (path === '/repos/team/repo/pulls/12/reviews') return json({ id: 1 });
    if (path === '/repos/team/repo/pulls/12/merge') { const reply = merges.shift()!; return json(reply.body ?? {}, reply.status); }
    if (path === '/repos/team/repo/pulls/12' && method === 'PATCH') return json(options.close?.body ?? { state: 'closed' }, options.close?.status ?? 200);
    if (path === `/repos/team/repo/git/refs/heads/${pull.branch}` && method === 'DELETE') return new Response(null, { status: 204 });
    return json({ message: 'Not Found' }, 404);
  };
  return { calls, client: createGitHub({ appId: '9', privateKey, accountId: '42', userToken: 'user-token', fetcher }) };
}
const signal = () => AbortSignal.timeout(5000);
const decisions = (calls: { method: string; path: string }[]) => calls.filter(call => /pulls\/12|git\/refs/.test(call.path)).map(call => `${call.method} ${call.path}`);

test('approving merges the reviewed head as the user, skipping merge methods the repository disallows', async () => {
  const { calls, client } = github({ merges: [{ status: 405, body: { message: 'Squash merges are not allowed on this repository.' } }, { status: 200, body: { merged: true, sha: merged } }] });
  assert.deepEqual(await client.decidePullRequest('team/repo', pull, 'merge', signal()), { action: 'merged', commit: merged, already: false });
  assert.deepEqual(decisions(calls), ['GET /repos/team/repo/pulls/12', 'POST /repos/team/repo/pulls/12/reviews', 'PUT /repos/team/repo/pulls/12/merge',
    'PUT /repos/team/repo/pulls/12/merge', `DELETE /repos/team/repo/git/refs/heads/${pull.branch}`]);
  const acting = calls.filter(call => /pulls\/12|git\/refs/.test(call.path));
  assert.ok(acting.every(call => call.token === 'Bearer user-token'), 'the reviewer acts as themselves');
  assert.deepEqual(acting.filter(call => call.path.endsWith('/merge')).map(call => call.body), [{ merge_method: 'squash', sha: head }, { merge_method: 'merge', sha: head }]);
  assert.equal(acting.find(call => call.path.endsWith('/reviews'))!.body!.commit_id, head);
});

test('GitHub refusals stop the merge and reach the reviewer; the branch stays', async () => {
  const required = github({ merges: [{ status: 405, body: { message: 'At least 1 approving review is required by reviewers with write access.' } }] });
  await assert.rejects(required.client.decidePullRequest('team/repo', pull, 'merge', signal()),
    (error: unknown) => error instanceof IntakeError && error.status === 409 && error.message === 'GitHub refused the merge: At least 1 approving review is required by reviewers with write access.');
  assert.equal(decisions(required.calls).filter(call => call.startsWith('PUT')).length, 1);
  assert.equal(decisions(required.calls).some(call => call.startsWith('DELETE')), false);
  const moved = github({ merges: [{ status: 409, body: { message: 'Head branch was modified. Review and try the merge again.' } }] });
  await assert.rejects(moved.client.decidePullRequest('team/repo', pull, 'merge', signal()), /changed after you reviewed it/);
});

test('rejecting closes the pull request and deletes its branch; decisions made on GitHub are recorded as they are', async () => {
  const { calls, client } = github();
  assert.deepEqual(await client.decidePullRequest('team/repo', pull, 'close', signal()), { action: 'closed', commit: null, already: false });
  assert.deepEqual(decisions(calls), ['GET /repos/team/repo/pulls/12', 'PATCH /repos/team/repo/pulls/12', `DELETE /repos/team/repo/git/refs/heads/${pull.branch}`]);
  assert.deepEqual(calls.find(call => call.method === 'PATCH')!.body, { state: 'closed' });
  const done = github({ state: { state: 'closed', merged: true, merge_commit_sha: merged } });
  assert.deepEqual(await done.client.decidePullRequest('team/repo', pull, 'close', signal()), { action: 'merged', commit: merged, already: true });
  assert.deepEqual(decisions(done.calls), ['GET /repos/team/repo/pulls/12']);
});

test('only users who can push decide, and only on TripSit branches', async () => {
  const reader = github({ push: false });
  await assert.rejects(reader.client.decidePullRequest('team/repo', pull, 'merge', signal()), (error: unknown) => error instanceof IntakeError && error.status === 403);
  assert.equal(decisions(reader.calls).length, 0);
  await assert.rejects(github().client.decidePullRequest('team/repo', { ...pull, branch: 'main' }, 'merge', signal()), (error: unknown) => error instanceof IntakeError && error.status === 400);
  const swapped = github({ state: { head: { ref: 'feature/other', sha: head } } });
  await assert.rejects(swapped.client.decidePullRequest('team/repo', pull, 'merge', signal()), /no longer comes from its TripSit branch/);
});
