import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/intake-retention.ts', import.meta.url));

test('retention CLI refuses missing and nonlocal configuration without exposing credentials', async () => {
  for (const value of ['', 'postgres://secret-user:secret-password@remote.invalid/tripsit_e01s01_test', 'postgres://localhost/production']) {
    await assert.rejects(() => run(process.execPath, ['--experimental-strip-types', script], {
      env: { ...process.env, TRIPSIT_TEST_DATABASE_URL: value }, timeout: 10_000
    }), (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? '', /Retention verification unavailable/);
      assert(!error.stderr?.includes('secret-password'));
      return true;
    });
  }
});

test('two timed real purge subprocesses delete only expired raw snapshots and preserve metadata', async () => {
  assert(process.env.TRIPSIT_TEST_DATABASE_URL, 'Set the explicitly disposable local TRIPSIT_TEST_DATABASE_URL; this integration test cannot skip.');
  const result = await run(process.execPath, ['--experimental-strip-types', script], {
    env: process.env, timeout: 30_000, maxBuffer: 16_384
  });
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'passed_local_only');
  assert.deepEqual(report.cycles.map((cycle: { purged: number }) => cycle.purged), [1, 1]);
  assert.equal(report.rawRemaining, 1);
  assert.equal(report.metadataRetained, 3);
  assert.equal(report.expiredMetadata, 2);
  assert.match(report.codeDigest, /^[a-f0-9]{64}$/);
  assert.match(report.configDigest, /^[a-f0-9]{64}$/);
  assert.equal(report.productionScheduleVerified, false);
  assert(!result.stdout.includes('retention-fixture-source'));
  assert(!result.stdout.includes('postgres://'));
});
