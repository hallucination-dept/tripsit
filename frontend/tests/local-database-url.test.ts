import assert from 'node:assert/strict';
import test from 'node:test';
import { testDatabaseUrl } from '../src/lib/server/records.ts';

test('disposable database guard rejects driver overrides and fragments', () => {
  const local = 'postgres://test:test@127.0.0.1:5432/tripsit_e01s01_test';
  assert.equal(testDatabaseUrl(local), local);
  for (const suffix of ['?host=remote.example', '?options=-csearch_path=public', '?port=6543', '#unparsed']) {
    assert.throws(() => testDatabaseUrl(local + suffix), /disposable/);
  }
});
