import assert from 'node:assert/strict';
import test from 'node:test';
import { createGenerationLimit } from '../src/lib/server/generation-limit.ts';

test('generation limits concurrent and repeated owner requests, releases errors, and expires counters', async () => {
  let now = 0;
  const limit = createGenerationLimit(() => now);
  let release!: () => void;
  const first = limit.run('owner', () => new Promise<void>(resolve => { release = resolve; }));
  await assert.rejects(() => limit.run('owner', async () => {}), { status: 429 });
  await limit.run('other', async () => {});
  release(); await first;
  await assert.rejects(() => limit.run('owner', async () => { throw new Error('fixture'); }), /fixture/);
  await limit.run('owner', async () => {});
  await assert.rejects(() => limit.run('owner', async () => {}), { status: 429 });
  now = 15 * 60_000;
  await limit.run('owner', async () => {});
});
