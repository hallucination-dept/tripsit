import assert from 'node:assert/strict';
import test from 'node:test';
import { browserConfiguration, browserCookies } from '../scripts/intake-browser.mjs';

test('browser UAT requires explicit local origin, two real sessions and issue fixture', () => {
  assert.throws(() => browserConfiguration({}), /configuration/);
  const env = { TRIPSIT_LIVE_ORIGIN: 'http://127.0.0.1:5173', TRIPSIT_LIVE_OWNER_COOKIE: 'session=owner', TRIPSIT_LIVE_OTHER_COOKIE: 'session=other', TRIPSIT_LIVE_REPOSITORY: 'team/repo', TRIPSIT_LIVE_ISSUE_NUMBER: '2' };
  assert.equal(browserConfiguration(env).issueNumber, 2);
  for (const change of [{TRIPSIT_LIVE_ORIGIN:'https://production.example'}, {TRIPSIT_LIVE_ORIGIN:'http://user:password@localhost:5173'}, {TRIPSIT_LIVE_REPOSITORY:'../repo'}, {TRIPSIT_LIVE_ISSUE_NUMBER:'2.5'}, {TRIPSIT_LIVE_ISSUE_NUMBER:'2e1'}, {TRIPSIT_LIVE_ISSUE_NUMBER:' 2'}, {TRIPSIT_LIVE_ISSUE_NUMBER:'+2'}, {TRIPSIT_LIVE_OTHER_COOKIE:'session=owner'}]) {
    assert.throws(() => browserConfiguration({...env,...change}));
  }
});

test('cookies preserve legitimate session values without accepting cookie attributes or controls', () => {
  const cookies = browserCookies('session=abc%3D; account=def', 'http://127.0.0.1:5173');
  assert.equal(cookies[0].value,'abc%3D');
  assert(cookies.every(cookie => cookie.url === 'http://127.0.0.1:5173' && cookie.httpOnly));
  for (const input of ['session=abc\nInjected: x','session=abc; Path=/','session=abc; session=def']) assert.throws(()=>browserCookies(input,'http://localhost:5173'));
});
