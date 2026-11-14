CREATE TABLE IF NOT EXISTS tripsit_candidates (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  output_digest text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS tripsit_candidates_owner ON tripsit_candidates(owner_id, created_at);
CREATE TABLE IF NOT EXISTS tripsit_candidate_payloads (
  candidate_id uuid PRIMARY KEY REFERENCES tripsit_candidates(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES tripsit_snapshots(work_item_id) ON DELETE CASCADE,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS tripsit_candidate_payloads_item ON tripsit_candidate_payloads(work_item_id);
