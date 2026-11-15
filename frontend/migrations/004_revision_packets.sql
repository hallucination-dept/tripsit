CREATE TABLE IF NOT EXISTS tripsit_revision_packets (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES tripsit_candidate_payloads(candidate_id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  commit_sha text NOT NULL,
  packet_digest text NOT NULL,
  source_digest text NOT NULL,
  snapshot_digest text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE(candidate_id, packet_digest, source_digest, snapshot_digest)
);
