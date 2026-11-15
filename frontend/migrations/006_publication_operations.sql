CREATE TABLE IF NOT EXISTS tripsit_publication_operations (
  candidate_id uuid PRIMARY KEY REFERENCES tripsit_candidate_payloads(candidate_id) ON DELETE CASCADE,
  packet_id uuid NOT NULL REFERENCES tripsit_revision_packets(id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  commit_sha text NOT NULL,
  branch text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'creating', 'completed')),
  pr_number integer,
  pr_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
