import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentRuns, parseDecisionInput, parseRunInput, RunFailure, type DecisionPerformer, type RunContext, type RunDetail, type RunExecutor, type RunResult, type RunStore } from '../src/lib/server/agent-runs.ts';
import { IntakeError } from '../src/lib/server/intake.ts';
import type { RepositoryArchive } from '../src/lib/server/github.ts';

const archive: RepositoryArchive = { repository: 'team/app', branch: 'main', sha: 'a'.repeat(40), download: async () => new ReadableStream(),
  publish: { available: false, reason: 'read only' } };
const result: RunResult = { summary: 'Changed one file.', truncated: false, pullRequest: { number: 12, url: 'https://github.com/team/app/pull/12', branch: 'tripsit/run1' },
  publishNote: null, files: [{ path: 'a.ts', change: 'modified', binary: false, diff: '@@' }],
  graph: { nodes: [], edges: [], symbolDiffs: {}, stats: { files: 1, changedFiles: 1, focusFiles: 1, hiddenNeighbors: 0, symbols: 0 } } };
const settle = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));

function memoryStore() {
  const rows = new Map<string, { owner: string; run: RunDetail }>();
  const writes: string[] = [];
  const store: RunStore = {
    async ready() {},
    async insert(owner, run) { rows.set(run.id, { owner, run: structuredClone(run) }); writes.push(`insert:${run.status}`); },
    async save(owner, run) {
      const row = rows.get(run.id);
      if (row?.owner === owner) row.run = structuredClone(run);
      writes.push(`save:${run.status}`);
    },
    async list(owner) {
      return [...rows.values()].filter(row => row.owner === owner).map(({ run }) => {
        const { events: _events, result: _result, ...summary } = run;
        return summary;
      }).reverse();
    },
    async get(owner, id) { const row = rows.get(id); return row?.owner === owner ? structuredClone(row.run) : null; },
    async picture(id) { const run = rows.get(id)?.run; return run?.status === 'done' && run.result ? { graph: run.result.graph, flags: run.result.flags ?? [] } : null; }
  };
  return { rows, writes, store };
}

function controllable() {
  const contexts: RunContext[] = [];
  const pending: { resolve: (value: RunResult) => void; reject: (error: unknown) => void }[] = [];
  const execute: RunExecutor = context => new Promise((resolve, reject) => {
    contexts.push(context);
    pending.push({ resolve, reject });
    context.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  return { contexts, pending, execute };
}

test('a run moves through its stages, is saved, and stays readable for its owner only', async () => {
  const fake = controllable(), memory = memoryStore();
  const runs = createAgentRuns({ execute: fake.execute, store: memory.store, id: () => 'run-1', saveDelayMs: 1 });
  const started = await runs.start('owner', archive, 'Rename the helper');
  assert.equal(started.status, 'preparing');
  assert.equal(memory.rows.get('run-1')?.run.status, 'preparing', 'the run is stored before it starts working');
  fake.contexts[0].stage('running');
  fake.contexts[0].emit('tool', 'bash: ls');
  assert.equal((await runs.get('owner', 'run-1')).status, 'running');
  fake.pending[0].resolve(result);
  await settle();
  const done = await runs.get('owner', 'run-1');
  assert.equal(done.status, 'done');
  assert.equal(done.pullRequest?.number, 12);
  assert.deepEqual(done.events.map(event => event.kind), ['status', 'tool', 'status']);
  assert.equal(memory.rows.get('run-1')?.run.status, 'done', 'the final state is written');
  assert.equal(memory.writes.at(-1), 'save:done');
  assert.equal((await runs.list('owner'))[0].changedFiles, 1);
  await assert.rejects(runs.get('intruder', 'run-1'), /not found/);
  assert.deepEqual(await runs.list('intruder'), []);
});

test('after a restart, finished runs are read back and runs left mid-flight are reported as interrupted', async () => {
  const fake = controllable(), memory = memoryStore();
  let next = 0;
  const first = createAgentRuns({ execute: fake.execute, store: memory.store, id: () => `run-${++next}`, saveDelayMs: 1 });
  await first.start('owner', archive, 'finished before restart');
  fake.pending[0].resolve(result);
  await settle();
  await first.start('owner', archive, 'running when the server restarts');
  fake.contexts[1].stage('running');
  await settle();
  const restarted = createAgentRuns({ execute: fake.execute, store: memory.store });
  assert.equal((await restarted.get('owner', 'run-1')).status, 'done');
  const orphan = await restarted.get('owner', 'run-2');
  assert.equal(orphan.status, 'failed');
  assert.match(orphan.error ?? '', /server restarted/);
  assert.equal(memory.rows.get('run-2')?.run.status, 'failed', 'the interruption is saved');
  assert.deepEqual((await restarted.list('owner')).map(run => run.status).sort(), ['done', 'failed']);
  assert.equal((await restarted.cancel('owner', 'run-1')).status, 'done', 'cancelling a finished run changes nothing');
});

test('limits allow one active run per owner, bound the process and the hourly rate', async () => {
  const fake = controllable(), memory = memoryStore();
  let now = 0, next = 0;
  const runs = createAgentRuns({ execute: fake.execute, store: memory.store, clock: () => now, id: () => `run-${++next}`, maxActive: 2, perHour: 2, saveDelayMs: 1 });
  await runs.start('a', archive, 'one');
  await assert.rejects(runs.start('a', archive, 'two'), /current agent run/);
  await runs.start('b', archive, 'one');
  await assert.rejects(runs.start('c', archive, 'one'), (error: Error & { status?: number }) => error.status === 503);
  fake.pending[0].resolve(result);
  await settle();
  await runs.start('a', archive, 'two');
  fake.pending[2].resolve(result);
  await settle();
  await assert.rejects(runs.start('a', archive, 'three'), /2 per hour/);
  now = 3_600_001;
  assert.equal((await runs.start('a', archive, 'four')).status, 'preparing');
  const failing = memoryStore();
  failing.store.insert = async () => { throw new Error('database down'); };
  const blocked = createAgentRuns({ execute: fake.execute, store: failing.store });
  await assert.rejects(blocked.start('d', archive, 'x'), /database down/);
  await assert.rejects(blocked.start('d', archive, 'x'), /database down/, 'a failed insert frees the slot');
});

test('cancellation, deadlines and failures end runs with bounded owner-facing messages', async () => {
  const fake = controllable(), memory = memoryStore();
  let next = 0;
  const runs = createAgentRuns({ execute: fake.execute, store: memory.store, id: () => `run-${++next}`, deadlineMs: 20, maxEvents: 3, saveDelayMs: 1 });
  await runs.start('a', archive, 'cancel me');
  assert.equal((await runs.cancel('a', 'run-1')).status, 'preparing');
  await settle();
  assert.equal((await runs.get('a', 'run-1')).status, 'cancelled');
  assert.equal((await runs.get('a', 'run-1')).error, 'Cancelled by you.');
  assert.ok(fake.contexts[0].signal.aborted);

  await runs.start('b', archive, 'too slow');
  await settle(40);
  assert.equal((await runs.get('b', 'run-2')).status, 'failed');
  assert.match((await runs.get('b', 'run-2')).error ?? '', /time limit/);

  await runs.start('c', archive, 'explained failure');
  for (let index = 0; index < 5; index++) fake.contexts[2].emit('tool', `step ${index}`);
  fake.pending[2].reject(new RunFailure('The agent stopped: context window exceeded'));
  await settle();
  await runs.start('d', archive, 'unexpected failure');
  fake.pending[3].reject(new Error('internal detail with /secret/path'));
  await settle();
  assert.equal((await runs.get('c', 'run-3')).error, 'The agent stopped: context window exceeded');
  assert.equal((await runs.get('c', 'run-3')).events.length, 3);
  assert.equal((await runs.get('d', 'run-4')).error, 'The agent run failed unexpectedly.');
  assert.equal(JSON.stringify(memory.rows.get('run-4')?.run).includes('/secret/path'), false);
});

test('run input requires a repository and a bounded instruction', () => {
  assert.deepEqual(parseRunInput({ repository: 'team/app', instruction: '  Add a test  ' }), { repository: 'team/app', instruction: 'Add a test' });
  for (const value of [null, [], { repository: 'team/app' }, { repository: 'team/app', instruction: ' ' },
    { repository: 'team/app', instruction: 'x'.repeat(8001) }, { repository: 'team/app', instruction: 'ok', extra: true }]) {
    assert.throws(() => parseRunInput(value), (error: Error & { status?: number }) => error.status === 400);
  }
});

test('after a successful run is saved, the finisher runs and its note joins the log', async () => {
  const fake = controllable(), memory = memoryStore();
  let next = 0;
  const seen: string[] = [];
  const runs = createAgentRuns({ execute: fake.execute, store: memory.store, id: () => `run-${++next}`, saveDelayMs: 1,
    finish: async ({ id, result: finished }) => {
      seen.push(`${id}:${memory.rows.get(id)?.run.status}:${finished.pullRequest?.number}`);
      return 'Added the change graph to pull request #12';
    } });
  await runs.start('owner', archive, 'with a pull request');
  assert.equal(await runs.picture('run-1'), null, 'no picture while the run is working');
  fake.pending[0].resolve(result);
  await settle();
  assert.deepEqual(seen, ['run-1:done:12'], 'the run was stored as done before the finisher ran');
  const done = await runs.get('owner', 'run-1');
  assert.equal(done.events.at(-1)?.text, 'Added the change graph to pull request #12');
  assert.equal(memory.rows.get('run-1')?.run.events.at(-1)?.text, 'Added the change graph to pull request #12', 'the note is saved');
  assert.deepEqual(await runs.picture('run-1'), { graph: result.graph, flags: [] }, 'a finished run serves its graph from storage');
  await runs.start('owner', archive, 'failing');
  fake.pending[1].reject(new Error('boom'));
  await settle();
  assert.equal(seen.length, 1, 'failed runs are not finished');
});

test('the owner merges or closes a finished run\'s pull request once, and parallel clicks are refused', async () => {
  const fake = controllable(), memory = memoryStore();
  const runs = createAgentRuns({ execute: fake.execute, store: memory.store, id: () => 'run-1', saveDelayMs: 1, clock: () => Date.parse('2026-11-15T10:00:00Z') });
  await runs.start('owner', archive, 'Rename the helper');
  const performed: string[] = [];
  let release = () => {};
  const merge: DecisionPerformer = async ({ repository, pullRequest }) => {
    performed.push(`${repository}#${pullRequest.number}`);
    await new Promise<void>(resolve => { release = resolve; });
    return { action: 'merged', commit: 'f'.repeat(40), already: false };
  };
  await assert.rejects(runs.decide('owner', 'run-1', merge), /Wait for the run to finish/);
  fake.pending[0].resolve(result);
  await settle();
  await assert.rejects(runs.decide('stranger', 'run-1', merge), /not found/);
  const first = runs.decide('owner', 'run-1', merge);
  await assert.rejects(runs.decide('owner', 'run-1', merge), /already being merged or closed/);
  await settle(5);
  release();
  const decided = await first;
  assert.deepEqual(performed, ['team/app#12'], 'GitHub is asked once');
  assert.deepEqual(decided.result!.decision, { action: 'merged', at: '2026-11-15T10:00:00.000Z', commit: 'f'.repeat(40) });
  assert.equal(decided.events.at(-1)!.text, 'Merged pull request #12 as fffffff');
  const stored = (await runs.get('owner', 'run-1')).result!;
  assert.equal(stored.decision!.action, 'merged', 'the decision is saved with the run');
  await assert.rejects(runs.decide('owner', 'run-1', merge), /already merged/);
});

test('a refused decision leaves the run undecided, and runs without a pull request cannot be decided', async () => {
  const fake = controllable(), memory = memoryStore();
  let next = 0;
  const runs = createAgentRuns({ execute: fake.execute, store: memory.store, id: () => `run-${++next}`, saveDelayMs: 1, perHour: 10 });
  await runs.start('owner', archive, 'First');
  fake.pending[0].resolve(result);
  await settle();
  await assert.rejects(runs.decide('owner', 'run-1', async () => { throw new IntakeError(409, 'GitHub refused the merge: checks are failing.'); }), /checks are failing/);
  assert.equal((await runs.get('owner', 'run-1')).result!.decision, undefined);
  const closed = await runs.decide('owner', 'run-1', async () => ({ action: 'closed', commit: null, already: true }));
  assert.equal(closed.events.at(-1)!.text, 'Closed pull request #12 without merging (it was already closed on GitHub)');
  await runs.start('owner', archive, 'Second');
  fake.pending[1].resolve({ ...result, pullRequest: null });
  await settle();
  await assert.rejects(runs.decide('owner', 'run-2', async () => ({ action: 'merged', commit: null, already: false })), /no pull request/);
  assert.deepEqual([parseDecisionInput({ action: 'merge' }), parseDecisionInput({ action: 'close' })], ['merge', 'close']);
  for (const bad of [null, {}, { action: 'approve' }, { action: 'merge', extra: 1 }]) assert.throws(() => parseDecisionInput(bad), /merge or close/);
});
