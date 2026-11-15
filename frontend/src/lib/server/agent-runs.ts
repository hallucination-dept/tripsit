import { randomUUID } from 'node:crypto';
import { IntakeError } from './intake.ts';
import type { ChangeGraph } from './change-graph.ts';
import type { AgentFlag } from './flags.ts';
import type { RunConfidence } from '../edit-confidence.ts';
import type { PullRequest, RepositoryArchive } from './github.ts';

export type RunStatus = 'preparing' | 'running' | 'analyzing' | 'publishing' | 'done' | 'failed' | 'cancelled';
export type RunEvent = { at: string; kind: 'status' | 'assistant' | 'tool' | 'error'; text: string };
export type RunFile = { path: string; change: 'added' | 'modified' | 'deleted'; binary: boolean; diff: string };
export type RunResult = {
  summary: string; graph: ChangeGraph; files: RunFile[]; truncated: boolean;
  pullRequest: PullRequest | null; publishNote: string | null;
  // Review flags the agent attached to its edits; runs saved before flags existed have none.
  flags?: AgentFlag[];
  // Token confidence per changed node; runs saved before it existed have none.
  confidence?: RunConfidence;
};
export type RunPicture = { graph: ChangeGraph; flags: AgentFlag[] };
export type RunSummary = {
  id: string; repository: string; branch: string; sha: string; instruction: string; status: RunStatus;
  createdAt: string; finishedAt: string | null; error: string | null; changedFiles: number | null; pullRequest: PullRequest | null;
};
export type RunDetail = RunSummary & { events: RunEvent[]; result: RunResult | null };
export type RunContext = {
  id: string; archive: RepositoryArchive; instruction: string; signal: AbortSignal;
  emit: (kind: RunEvent['kind'], text: string) => void;
  stage: (status: 'preparing' | 'running' | 'analyzing' | 'publishing') => void;
};
export type RunExecutor = (context: RunContext) => Promise<RunResult>;
// Durable storage for runs; agent-run-records.ts implements it on PostgreSQL.
export type RunStore = {
  ready(): Promise<void>;
  insert(owner: string, run: RunDetail, expiresAt: string): Promise<void>;
  save(owner: string, run: RunDetail): Promise<void>;
  list(owner: string): Promise<RunSummary[]>;
  get(owner: string, id: string): Promise<RunDetail | null>;
  // The graph and flags of a finished, unexpired run regardless of owner; callers must authorize the request themselves.
  picture(id: string): Promise<RunPicture | null>;
};
// Runs after a successful run is saved, e.g. to comment on its pull request. A returned text is added to the run log.
export type RunFinisher = (run: { id: string; archive: RepositoryArchive; result: RunResult }) => Promise<string | null>;

// Messages of this error are shown to the run's owner; other failures stay generic.
export class RunFailure extends Error {}

export function parseRunInput(value: unknown): { repository: string; instruction: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IntakeError(400, 'Select a repository and describe the change.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== 'repository' && key !== 'instruction') ||
    typeof input.repository !== 'string' || typeof input.instruction !== 'string') {
    throw new IntakeError(400, 'Select a repository and describe the change.');
  }
  const instruction = input.instruction.trim();
  if (!instruction || instruction.length > 8000) throw new IntakeError(400, 'Describe the change in 1 to 8,000 characters.');
  return { repository: input.repository, instruction };
}

type Run = {
  id: string; owner: string; archive: RepositoryArchive; instruction: string; status: RunStatus;
  createdAt: number; finishedAt: number | null; error: string | null; events: RunEvent[];
  result: RunResult | null; controller: AbortController; cancelled: boolean;
  saveTimer: ReturnType<typeof setTimeout> | null; saving: Promise<void>;
};
type Options = {
  execute: RunExecutor; store: RunStore; finish?: RunFinisher; clock?: () => number; id?: () => string; deadlineMs?: number;
  maxActive?: number; perHour?: number; maxEvents?: number; retentionMs?: number; saveDelayMs?: number;
};

const terminal = (status: RunStatus) => status === 'done' || status === 'failed' || status === 'cancelled';
const clip = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit)}…` : value;
const notFound = () => new IntakeError(404, 'Agent run not found.');
const interrupted = 'Interrupted because the server restarted.';

// shortcut: active runs and rate limits live in this process; stored runs that are still marked active but are not
// running here are reported as interrupted. Use shared coordination before running multiple server instances.
export function createAgentRuns(options: Options) {
  const clock = options.clock ?? Date.now;
  const newId = options.id ?? randomUUID;
  const deadlineMs = options.deadlineMs ?? 20 * 60_000;
  const maxActive = options.maxActive ?? 2, perHour = options.perHour ?? 6, maxEvents = options.maxEvents ?? 300;
  const retentionMs = options.retentionMs ?? 7 * 24 * 3_600_000, saveDelayMs = options.saveDelayMs ?? 1500;
  const active = new Map<string, Run>();
  const starts = new Map<string, number[]>();
  const iso = (time: number) => new Date(time).toISOString();

  function summary(run: Run): RunSummary {
    return { id: run.id, repository: run.archive.repository, branch: run.archive.branch, sha: run.archive.sha,
      instruction: run.instruction, status: run.status, createdAt: iso(run.createdAt),
      finishedAt: run.finishedAt === null ? null : iso(run.finishedAt), error: run.error,
      changedFiles: run.result ? run.result.files.length : null, pullRequest: run.result?.pullRequest ?? null };
  }
  const detail = (run: Run): RunDetail => ({ ...summary(run), events: [...run.events], result: run.result });

  // Writes are serialized per run; while it runs they are debounced, the final state is written at once.
  function persist(run: Run, immediately = false) {
    if (run.saveTimer) { clearTimeout(run.saveTimer); run.saveTimer = null; }
    const write = () => {
      run.saving = run.saving.then(() => options.store.save(run.owner, detail(run)))
        .catch(() => { console.error('Agent run could not be saved'); });
      return run.saving;
    };
    if (immediately) return write();
    run.saveTimer = setTimeout(() => { run.saveTimer = null; void write(); }, saveDelayMs);
    run.saveTimer.unref?.();
    return run.saving;
  }
  function emit(run: Run, kind: RunEvent['kind'], text: string) {
    run.events.push({ at: iso(clock()), kind, text: clip(text, 4000) });
    if (run.events.length > maxEvents) run.events.splice(0, run.events.length - maxEvents);
    void persist(run);
  }
  function settle(stored: RunDetail): RunDetail {
    return terminal(stored.status) ? stored : { ...stored, status: 'failed', error: interrupted, finishedAt: stored.finishedAt ?? iso(clock()) };
  }

  async function execute(run: Run) {
    const deadline = setTimeout(() => run.controller.abort(), deadlineMs);
    deadline.unref?.();
    try {
      const result = await options.execute({
        id: run.id, archive: run.archive, instruction: run.instruction, signal: run.controller.signal,
        emit: (kind, text) => emit(run, kind, text),
        stage: status => { if (!terminal(run.status)) { run.status = status; void persist(run); } }
      });
      if (run.controller.signal.aborted) throw new RunFailure('The agent run was cancelled or timed out.');
      run.result = result;
      run.status = 'done';
      emit(run, 'status', `Finished with ${result.files.length} changed file${result.files.length === 1 ? '' : 's'}`);
    } catch (cause) {
      run.status = run.cancelled ? 'cancelled' : 'failed';
      run.error = run.cancelled ? 'Cancelled by you.'
        : run.controller.signal.aborted ? 'The agent run exceeded its time limit.'
        : cause instanceof RunFailure || cause instanceof IntakeError ? clip(cause.message, 600)
        : 'The agent run failed unexpectedly.';
      if (!(cause instanceof RunFailure || cause instanceof IntakeError) && !run.controller.signal.aborted) {
        console.error('Agent run failed', cause instanceof Error ? cause.name : typeof cause);
      }
      emit(run, 'error', run.error);
    } finally {
      clearTimeout(deadline);
      run.finishedAt = clock();
      await persist(run, true);
      active.delete(run.id);
    }
    if (run.status === 'done' && run.result && options.finish) {
      const note = await options.finish({ id: run.id, archive: run.archive, result: run.result })
        .catch(() => 'A follow-up step after the run failed.');
      if (note) { emit(run, 'status', note); await persist(run, true); }
    }
  }

  return {
    ready: () => options.store.ready(),
    async start(owner: string, archive: RepositoryArchive, instruction: string): Promise<RunDetail> {
      const now = clock();
      for (const [key, times] of starts) {
        const recent = times.filter(time => now - time < 3_600_000);
        if (recent.length) starts.set(key, recent); else starts.delete(key);
      }
      const running = [...active.values()];
      if (running.some(run => run.owner === owner)) throw new IntakeError(429, 'Wait for your current agent run to finish.');
      const recent = starts.get(owner) ?? [];
      if (recent.length >= perHour) throw new IntakeError(429, `Agent runs are limited to ${perHour} per hour.`);
      if (running.length >= maxActive) throw new IntakeError(503, 'The agent is busy. Try again in a few minutes.');
      const run: Run = { id: newId(), owner, archive, instruction, status: 'preparing', createdAt: now, finishedAt: null,
        error: null, events: [], result: null, controller: new AbortController(), cancelled: false, saveTimer: null, saving: Promise.resolve() };
      run.events.push({ at: iso(now), kind: 'status', text: `Started on ${archive.repository} at ${archive.sha.slice(0, 7)} (${archive.branch})` });
      active.set(run.id, run); // reserve the slot before the first write so parallel starts cannot pass the limits
      try { await options.store.insert(owner, detail(run), iso(now + retentionMs)); }
      catch (cause) { active.delete(run.id); throw cause; }
      starts.set(owner, [...recent, now]);
      void execute(run);
      return detail(run);
    },
    async get(owner: string, id: string): Promise<RunDetail> {
      const run = active.get(id);
      if (run) { if (run.owner !== owner) throw notFound(); return detail(run); }
      const stored = await options.store.get(owner, id);
      if (!stored) throw notFound();
      const current = settle(stored);
      if (current !== stored) await options.store.save(owner, current).catch(() => {});
      return current;
    },
    async picture(id: string): Promise<RunPicture | null> {
      const run = active.get(id);
      if (!run) return options.store.picture(id);
      return run.result ? { graph: run.result.graph, flags: run.result.flags ?? [] } : null;
    },
    async list(owner: string): Promise<RunSummary[]> {
      const live = new Map([...active.values()].filter(run => run.owner === owner).map(run => [run.id, summary(run)]));
      const stored = await options.store.list(owner);
      return stored.map(row => live.get(row.id) ?? (terminal(row.status) ? row : { ...row, status: 'failed' as const, error: interrupted }));
    },
    async cancel(owner: string, id: string): Promise<RunDetail> {
      const run = active.get(id);
      if (!run || run.owner !== owner) return this.get(owner, id);
      if (!run.cancelled) {
        run.cancelled = true;
        emit(run, 'status', 'Cancelling');
        run.controller.abort();
      }
      return detail(run);
    }
  };
}
