CREATE TABLE IF NOT EXISTS tripsit_work_items (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  snapshot_digest text NOT NULL,
  status text NOT NULL CHECK (status IN ('intake', 'expired')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS tripsit_work_items_owner ON tripsit_work_items(owner_id, created_at);
CREATE TABLE IF NOT EXISTS tripsit_snapshots (
  work_item_id uuid PRIMARY KEY REFERENCES tripsit_work_items(id),
  payload jsonb NOT NULL
);
