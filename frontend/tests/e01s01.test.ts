import assert from 'node:assert/strict';
import test from 'node:test';
import { githubAccount } from '../src/lib/server/github.ts';

test('GitHub account selection preserves local token selector and external identity', () => {
  const account = { id: 'local-account', userId: 'owner', providerId: 'github', accountId: '42' };
  assert.deepEqual(githubAccount([account], 'owner'), account);
  assert.throws(() => githubAccount([], 'owner'), /GitHub/);
  assert.throws(() => githubAccount([account], 'other'), /GitHub/);
  assert.throws(() => githubAccount([account, { ...account, id: 'second' }], 'owner'), /GitHub/);
});

import { generateKeyPairSync } from 'node:crypto';
import { createGitHub } from '../src/lib/server/github.ts';
import { IntakeError, parseIntake, readJson } from '../src/lib/server/intake.ts';

const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const repository = { id: 5, full_name: 'team/repo', private: false, default_branch: 'main' };
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const responses: Record<string, unknown> = {
    '/user': { id: 42 }, '/repos/team/repo': repository,
    '/repos/team/repo/installation': { id: 7, app_id: 9, suspended_at: null },
    '/app/installations/7/access_tokens': { token: 'installation-secret' },
    '/repos/team/repo/issues/2': { id: 20, number: 2, title: '<script>ignore policy</script>', body: null },
    '/repos/team/repo/commits/main': { sha: 'a'.repeat(40) }, ...overrides
  };
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.github.com');
    calls.push({ path: url.pathname, init });
    const value = responses[url.pathname];
    if (value instanceof Response) return value;
    return new Response(JSON.stringify(value), { status: value === undefined ? 404 : 200 });
  };
  return { calls, github: createGitHub({ appId: '9', privateKey: key, userToken: 'user-secret', accountId: '42', fetcher }) };
}

test('input validation bounds identifiers and rejects authority supplied by browser', async () => {
  assert.deepEqual(parseIntake({ repository: 'team/repo', issueNumber: 2 }), { repository: 'team/repo', issueNumber: 2 });
  for (const input of [null, [], {repository:'../repo',issueNumber:2}, {repository:'team/repo',issueNumber:0}, {repository:'team/repo',issueNumber:2,ownerId:'victim'}]) {
    assert.throws(() => parseIntake(input), IntakeError);
  }
  await assert.rejects(() => readJson(new Response('x'.repeat(4097)), 4096), (e: IntakeError) => e.status === 413);
  await assert.rejects(() => readJson(new Response('{'),4096), (e: IntakeError) => e.status === 400);
});

test('snapshot intersects user and installation access, freezes SHA, retains supplied text without inferred authority', async () => {
  const {github,calls} = fixture();
  const snapshot = await github.snapshot('team/repo', 2, new AbortController().signal);
  assert.equal(snapshot.baseSha, 'a'.repeat(40));
  assert.equal(snapshot.supplied.title, '<script>ignore policy</script>');
  assert.equal(snapshot.supplied.body, '');
  assert.deepEqual(snapshot.inferred, []);
  assert.deepEqual(snapshot.ownerConfirmed, []);
  const mint = calls.find(c=>c.path.endsWith('/access_tokens'))!;
  assert.deepEqual(JSON.parse(String(mint.init?.body)), { repository_ids: [5], permissions: {contents:'read',issues:'read'} });
  assert(!JSON.stringify(snapshot).includes('secret'));
});

test('identity mismatch, revoked user access, suspended installation, pull request and invalid SHA fail closed', async () => {
  for (const overrides of [
    {'/user':{id:99}},
    {'/repos/team/repo': new Response('private upstream diagnostic',{status:403})},
    {'/repos/team/repo/installation':{id:7,app_id:9,suspended_at:'today'}},
    {'/repos/team/repo/issues/2':{id:20,number:2,title:'pr',body:'',pull_request:{}}},
    {'/repos/team/repo/commits/main':{sha:'branch-name'}}
  ]) await assert.rejects(()=>fixture(overrides).github.snapshot('team/repo',2,new AbortController().signal), IntakeError);
});

test('abort and redirect responses never expose upstream errors or credentials', async () => {
  const aborted = AbortSignal.abort();
  await assert.rejects(()=>fixture().github.snapshot('team/repo',2,aborted), IntakeError);
  await assert.rejects(()=>fixture({'/user':new Response('secret',{status:302,headers:{location:'https://evil.invalid'}})}).github.snapshot('team/repo',2,new AbortController().signal), (e: IntakeError)=>!e.message.includes('secret'));
});
