CREATE TABLE IF NOT EXISTS tripsit_candidate_stages (
  candidate_id uuid PRIMARY KEY REFERENCES tripsit_candidate_payloads(candidate_id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  base_sha text NOT NULL,
  output_digest text NOT NULL,
  commit_sha text NOT NULL,
  tree_sha text NOT NULL,
  objects jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
