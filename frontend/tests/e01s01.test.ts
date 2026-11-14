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
