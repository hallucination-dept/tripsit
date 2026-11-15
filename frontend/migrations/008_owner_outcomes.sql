CREATE TABLE IF NOT EXISTS tripsit_owner_outcomes (
 id uuid PRIMARY KEY, owner_id text NOT NULL, request_id uuid NOT NULL,
 repository_id bigint NOT NULL, area text NOT NULL, packet_digest text NOT NULL,
 commit_sha text NOT NULL, decision_id uuid NOT NULL, kind text NOT NULL CHECK (kind IN ('escape','spot_check')),
 severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
 evidence_issue bigint NOT NULL CHECK (evidence_issue > 0), created_at timestamptz NOT NULL,
 UNIQUE(owner_id,request_id)
);
CREATE INDEX IF NOT EXISTS tripsit_outcome_area ON tripsit_owner_outcomes(owner_id,repository_id,area);
