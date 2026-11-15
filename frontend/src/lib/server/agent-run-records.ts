import { IntakeError } from './intake.ts';
import type { RunDetail, RunStore, RunSummary } from './agent-runs.ts';
import type { ChangeGraph } from './change-graph.ts';

type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null; affectedRows?: number }> };
type Summary = Pick<RunSummary, 'repository' | 'branch' | 'sha' | 'instruction' | 'error' | 'pullRequest'>;

const unavailable = () => new IntakeError(503, 'Agent run storage is unavailable; apply migration 003_agent_runs.sql.');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// jsonb cannot store U+0000, which can appear in captured shell output.
const json = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'string' ? item.replaceAll('\u0000', '') : item);
const iso = (value: unknown) => value === null || value === undefined ? null : new Date(value as string | Date).toISOString();
const columns = 'r.id, r.status, r.changed_files, r.created_at, r.finished_at, p.summary';

function summaryOf(run: RunDetail): Summary {
  return { repository: run.repository, branch: run.branch, sha: run.sha, instruction: run.instruction, error: run.error, pullRequest: run.pullRequest };
}

function fromRow(row: Record<string, unknown>): RunSummary {
  const summary = row.summary as Summary;
  return { id: String(row.id), repository: summary.repository, branch: summary.branch, sha: summary.sha, instruction: summary.instruction,
    status: row.status as RunSummary['status'], createdAt: iso(row.created_at)!, finishedAt: iso(row.finished_at),
    error: summary.error ?? null, changedFiles: row.changed_files === null ? null : Number(row.changed_files), pullRequest: summary.pullRequest ?? null };
}

// Run metadata stays after expiry; the payload holding repository content is deleted by `purge`.
export function createAgentRunRecords(database: Database, clock = () => new Date()) {
  async function query(sql: string, values?: unknown[]) {
    try { return await database.query(sql, values); }
    catch { throw unavailable(); }
  }
  return {
    async ready() {
      const result = await query("SELECT to_regclass('tripsit_agent_runs') IS NOT NULL AND to_regclass('tripsit_agent_run_payloads') IS NOT NULL AS ready");
      if (result.rows[0]?.ready !== true) throw unavailable();
    },
    async insert(owner, run, expiresAt) {
      await query(`INSERT INTO tripsit_agent_runs (id, owner_id, status, changed_files, created_at, updated_at, finished_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $5, $6, $7)`, [run.id, owner, run.status, run.changedFiles, run.createdAt, run.finishedAt, expiresAt]);
      await query('INSERT INTO tripsit_agent_run_payloads (run_id, summary, detail) VALUES ($1, $2::jsonb, $3::jsonb)',
        [run.id, json(summaryOf(run)), json({ events: run.events, result: run.result })]);
    },
    async save(owner, run) {
      await query('UPDATE tripsit_agent_runs SET status = $3, changed_files = $4, finished_at = $5, updated_at = $6 WHERE id = $1 AND owner_id = $2',
        [run.id, owner, run.status, run.changedFiles, run.finishedAt, clock().toISOString()]);
      await query(`UPDATE tripsit_agent_run_payloads SET summary = $3::jsonb, detail = $4::jsonb
        WHERE run_id = $1 AND EXISTS (SELECT 1 FROM tripsit_agent_runs WHERE id = $1 AND owner_id = $2)`,
        [run.id, owner, json(summaryOf(run)), json({ events: run.events, result: run.result })]);
    },
    async list(owner) {
      const result = await query(`SELECT ${columns} FROM tripsit_agent_runs r JOIN tripsit_agent_run_payloads p ON p.run_id = r.id
        WHERE r.owner_id = $1 AND r.expires_at > $2 ORDER BY r.created_at DESC LIMIT 50`, [owner, clock().toISOString()]);
      return result.rows.map(fromRow);
    },
    async get(owner, id) {
      if (!uuid.test(id)) return null;
      const result = await query(`SELECT ${columns}, p.detail FROM tripsit_agent_runs r JOIN tripsit_agent_run_payloads p ON p.run_id = r.id
        WHERE r.id = $1 AND r.owner_id = $2 AND r.expires_at > $3`, [id, owner, clock().toISOString()]);
      const row = result.rows[0];
      if (!row) return null;
      const detail = row.detail as Pick<RunDetail, 'events' | 'result'>;
      return { ...fromRow(row), events: detail.events ?? [], result: detail.result ?? null };
    },
    async graph(id) {
      if (!uuid.test(id)) return null;
      const result = await query(`SELECT p.detail->'result'->'graph' AS graph FROM tripsit_agent_runs r JOIN tripsit_agent_run_payloads p ON p.run_id = r.id
        WHERE r.id = $1 AND r.status = 'done' AND r.expires_at > $2`, [id, clock().toISOString()]);
      const graph = result.rows[0]?.graph;
      return graph && typeof graph === 'object' ? graph as ChangeGraph : null;
    },
    async purge(): Promise<number> {
      const result = await query('DELETE FROM tripsit_agent_run_payloads WHERE run_id IN (SELECT id FROM tripsit_agent_runs WHERE expires_at <= $1)',
        [clock().toISOString()]);
      return result.rowCount ?? result.affectedRows ?? 0;
    }
  } satisfies RunStore & { purge(): Promise<number> };
}
