import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { createGitHub } from '../src/lib/server/github.ts';
import { IntakeError } from '../src/lib/server/intake.ts';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const repository = { id: 5, full_name: 'team/repo', private: true, default_branch: 'main' };
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: { path: string; authorization: string; method: string }[] = [];
  const values: Record<string, unknown> = {
    '/user': { id: 42 },
    '/user/installations?per_page=100&page=1': { installations: [
      { id: 7, app_id: 9, suspended_at: null },
      { id: 8, app_id: 10, suspended_at: null },
      { id: 9, app_id: 9, suspended_at: '2026-01-01' }
    ] },
    '/user/installations/7/repositories?per_page=100&page=1': { repositories: [repository] },
    '/repos/team/repo': repository,
    '/repos/team/repo/installation': { id: 7, app_id: 9, suspended_at: null },
    '/app/installations/7/access_tokens': { token: 'fixture-installation-token' },
    '/repos/team/repo/issues?state=open&sort=updated&direction=desc&per_page=100&page=1': [
      { id: 11, number: 2, title: '<script>supplied title</script>', updated_at: '2026-01-01T00:00:00Z', body: 'must not return' },
      { id: 12, number: 3, title: 'pull request', updated_at: '2026-01-01T00:00:00Z', pull_request: {} }
    ], ...overrides
  };
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.github.com');
    const path = url.pathname + url.search;
    calls.push({ path, authorization: new Headers(init?.headers).get('Authorization') ?? '', method: init?.method ?? 'GET' });
    const value = values[path];
    return value instanceof Response ? value : new Response(JSON.stringify(value), { status: value === undefined ? 404 : 200 });
  };
  return { calls, github: createGitHub({ appId: '9', privateKey, userToken: 'fixture-user-token', accountId: '42', fetcher }) };
}

test('repository discovery intersects current user installations and excludes other or suspended Apps', async () => {
  const { github, calls } = fixture();
  assert.deepEqual(await github.repositories(new AbortController().signal), {
    repositories: [{ id: 5, fullName: 'team/repo', private: true }], complete: true
  });
  assert(calls.every(call => call.authorization === 'Bearer fixture-user-token' && call.method === 'GET'));
  assert(!calls.some(call => /installations\/(8|9)\//.test(call.path)));
});

test('issue discovery rechecks repository authority, excludes PRs and returns metadata only', async () => {
  const { github, calls } = fixture();
  assert.deepEqual(await github.issues('team/repo', new AbortController().signal), {
    issues: [{ id: 11, number: 2, title: '<script>supplied title</script>', updatedAt: '2026-01-01T00:00:00Z' }], complete: true
  });
  assert(calls.some(call => call.path === '/repos/team/repo/installation'));
  assert(calls.at(-1)?.authorization === 'Bearer fixture-installation-token');
});

test('pagination follows fixed-origin numbered pages and exposes exhausted page budgets', async () => {
  const first = new Response(JSON.stringify({ repositories: [repository] }), { headers: { Link: '<https://evil.invalid/steal>; rel="next"' } });
  const { github, calls } = fixture({
    '/user/installations/7/repositories?per_page=100&page=1': first,
    '/user/installations/7/repositories?per_page=100&page=2': new Response(JSON.stringify({ repositories: [{ ...repository, id: 6, full_name: 'team/second' }] }), { headers: { Link: '<https://evil.invalid/steal>; rel="next"' } }),
    '/user/installations/7/repositories?per_page=100&page=3': new Response(JSON.stringify({ repositories: [] }), { headers: { Link: '<https://evil.invalid/steal>; rel="next"' } }),
    '/user/installations/7/repositories?per_page=100&page=4': new Response(JSON.stringify({ repositories: [] }), { headers: { Link: '<https://evil.invalid/steal>; rel="next"' } })
  });
  const result = await github.repositories(new AbortController().signal);
  assert.equal(result.complete, false);
  assert.deepEqual(result.repositories.map(row => row.id), [5, 6]);
  assert.equal(calls.filter(call => call.path.includes('per_page=')).length, 5);
});

test('identity mismatch, removed access, malformed pages and invalid repository input fail closed', async () => {
  await assert.rejects(() => fixture({ '/user': { id: 99 } }).github.repositories(new AbortController().signal), IntakeError);
  await assert.rejects(() => fixture({ '/user/installations?per_page=100&page=1': { installations: 'invalid' } }).github.repositories(new AbortController().signal), IntakeError);
  await assert.rejects(() => fixture({ '/repos/team/repo': new Response('sensitive upstream', { status: 403 }) }).github.issues('team/repo', new AbortController().signal), (error: IntakeError) => error.status === 403 && !error.message.includes('sensitive'));
  const denied = fixture();
  await assert.rejects(() => denied.github.issues('../user', new AbortController().signal), IntakeError);
  assert.equal(denied.calls.length, 0);
  await assert.rejects(() => fixture().github.repositories(AbortSignal.abort()), IntakeError);
});
