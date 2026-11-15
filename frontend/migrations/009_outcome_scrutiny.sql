CREATE TABLE IF NOT EXISTS tripsit_outcome_epochs (
 owner_id text NOT NULL, repository_id bigint NOT NULL, version bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(owner_id,repository_id)
);
CREATE OR REPLACE FUNCTION tripsit_bump_outcome_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO tripsit_outcome_epochs(owner_id,repository_id,version) VALUES(NEW.owner_id,NEW.repository_id,1)
 ON CONFLICT(owner_id,repository_id) DO UPDATE SET version=tripsit_outcome_epochs.version+1;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tripsit_outcome_epoch ON tripsit_owner_outcomes;
CREATE TRIGGER tripsit_outcome_epoch AFTER INSERT ON tripsit_owner_outcomes FOR EACH ROW EXECUTE FUNCTION tripsit_bump_outcome_epoch();
INSERT INTO tripsit_outcome_epochs(owner_id,repository_id,version)
 SELECT owner_id,repository_id,count(*) FROM tripsit_owner_outcomes GROUP BY owner_id,repository_id
 ON CONFLICT(owner_id,repository_id) DO UPDATE SET version=GREATEST(tripsit_outcome_epochs.version,EXCLUDED.version);
ALTER TABLE tripsit_human_decisions ADD COLUMN IF NOT EXISTS regression_followup text NOT NULL DEFAULT '';
ALTER TABLE tripsit_human_decisions ADD COLUMN IF NOT EXISTS outcome_epoch bigint;
