ALTER TABLE tripsit_human_decisions DROP CONSTRAINT IF EXISTS tripsit_human_decisions_decision_check;
ALTER TABLE tripsit_human_decisions ADD CONSTRAINT tripsit_human_decisions_decision_check CHECK (decision IN ('accept', 'revise', 'escalate'));
ALTER TABLE tripsit_human_decisions ADD COLUMN IF NOT EXISTS deep_inspection boolean NOT NULL DEFAULT false;
