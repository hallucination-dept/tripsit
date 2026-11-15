CREATE TABLE IF NOT EXISTS tripsit_human_decisions (
  id uuid PRIMARY KEY,
  packet_id uuid NOT NULL REFERENCES tripsit_revision_packets(id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  request_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('revise', 'escalate')),
  inspection text NOT NULL,
  unchecked_scope text NOT NULL,
  residual_risk text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE(packet_id, request_id)
);
