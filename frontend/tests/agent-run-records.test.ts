import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createAgentRunRecords } from '../src/lib/server/agent-run-records.ts';
import type { RunDetail } from '../src/lib/server/agent-runs.ts';

// PGlite is PostgreSQL compiled to WebAssembly, so the real migration and queries run without a database server.
const migration = await readFile(new URL('../migrations/003_agent_runs.sql', import.meta.url), 'utf8');
const runId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const run = (n: number, overrides: Partial<RunDetail> = {}): RunDetail => ({
  id: runId(n), repository: 'team/app', branch: 'main', sha: 'a'.repeat(40), instruction: `Change ${n}`, status: 'preparing',
  createdAt: new Date(Date.UTC(2026, 10, 15, 10, n)).toISOString(), finishedAt: null, error: null, changedFiles: null, pullRequest: null,
  events: [{ at: '2026-11-15T10:00:00.000Z', kind: 'status', text: 'Started' }], result: null, ...overrides
});

test('storage is unavailable until the migration is applied', async () => {
  const db = new PGlite();
  await assert.rejects(createAgentRunRecords(db).ready(), (error: Error & { status?: number }) => error.status === 503 && /003_agent_runs/.test(error.message));
  await db.exec(migration);
  await createAgentRunRecords(db).ready();
});

test('runs round-trip per owner, list without their details, expire, and purge only their payloads', async () => {
  const db = new PGlite();
  await db.exec(migration);
  let now = new Date('2026-11-15T12:00:00Z');
  const records = createAgentRunRecords(db, () => now);
  await records.insert('owner', run(1), '2026-11-22T10:01:00Z');
  await records.insert('owner', run(2), '2026-11-16T10:02:00Z');
  await records.insert('other', run(3), '2026-11-22T10:03:00Z');
  const finished = run(1, {
    status: 'done', finishedAt: '2026-11-15T10:05:00.000Z', changedFiles: 1, error: null,
    pullRequest: { number: 12, url: 'https://github.com/team/app/pull/12', branch: 'tripsit/00000000' },
    events: [{ at: '2026-11-15T10:05:00.000Z', kind: 'tool', text: 'bash: printf "\u0000"' }],
    result: { summary: 'Done', truncated: false, pullRequest: { number: 12, url: 'https://github.com/team/app/pull/12', branch: 'tripsit/00000000' },
      publishNote: null, files: [{ path: 'a.ts', change: 'modified', binary: false, diff: '@@ -1 +1 @@' }],
      graph: { nodes: [], edges: [], symbolDiffs: {}, stats: { files: 3, changedFiles: 1, focusFiles: 1, hiddenNeighbors: 0, symbols: 0 } } }
  });
  await records.save('owner', finished);
  await records.save('other', { ...finished, status: 'failed' }, );
  const stored = await records.get('owner', runId(1));
  assert.equal(stored?.status, 'done', 'another owner cannot overwrite the run');
  assert.equal(stored?.pullRequest?.number, 12);
  assert.equal(stored?.result?.files[0].path, 'a.ts');
  assert.equal(stored?.events[0].text, 'bash: printf ""', 'NUL characters are stripped before jsonb');
  assert.equal(stored?.finishedAt, '2026-11-15T10:05:00.000Z');
  assert.equal(await records.get('other', runId(1)), null);
  assert.equal(await records.get('owner', 'not-a-uuid'), null);
  assert.deepEqual(await records.graph(runId(1)), finished.result?.graph, 'the graph of a finished run is readable by id');
  assert.equal(await records.graph(runId(2)), null, 'unfinished runs have no graph picture');
  assert.equal(await records.graph('not-a-uuid'), null);

  const listed = await records.list('owner');
  assert.deepEqual(listed.map(row => row.id), [runId(2), runId(1)], 'newest first');
  assert.equal('events' in listed[0], false, 'listing does not load run details');
  assert.deepEqual((await records.list('other')).map(row => row.id), [runId(3)]);

  now = new Date('2026-11-17T00:00:00Z');
  assert.deepEqual((await records.list('owner')).map(row => row.id), [runId(1)], 'expired runs are hidden');
  assert.equal(await records.get('owner', runId(2)), null);
  assert.equal(await records.purge(), 1);
  const remaining = await db.query<{ runs: number; payloads: number }>(
    'SELECT (SELECT count(*)::int FROM tripsit_agent_runs) AS runs, (SELECT count(*)::int FROM tripsit_agent_run_payloads) AS payloads');
  assert.deepEqual(remaining.rows[0], { runs: 3, payloads: 2 }, 'metadata stays, the expired payload is gone');
});
