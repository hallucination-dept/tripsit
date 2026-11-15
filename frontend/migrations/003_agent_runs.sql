-- Agent runs. The run row keeps source-free metadata; everything that carries repository content lives in the
-- payload row (summary: repository, commit, instruction, error, pull request; detail: agent log, diffs, change
-- graph), which the purge deletes once the run expires.
CREATE TABLE IF NOT EXISTS tripsit_agent_runs (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('preparing', 'running', 'analyzing', 'publishing', 'done', 'failed', 'cancelled')),
  changed_files integer CHECK (changed_files >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  finished_at timestamptz,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS tripsit_agent_runs_owner ON tripsit_agent_runs(owner_id, created_at DESC);
CREATE TABLE IF NOT EXISTS tripsit_agent_run_payloads (
  run_id uuid PRIMARY KEY REFERENCES tripsit_agent_runs(id) ON DELETE CASCADE,
  summary jsonb NOT NULL,
  detail jsonb NOT NULL
);
