-- Expand-only entity liveness. Existing 0051-aware binaries own a run and
-- revision but do not know these fields, so nothing is backfilled or inferred.
CREATE TYPE "public"."entity_extraction_claim_kind" AS ENUM ('QUEUED', 'REQUESTED');--> statement-breakpoint

ALTER TABLE "letters" ADD COLUMN "entity_extraction_lease_expires_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "entity_extraction_lease_run_id" uuid;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "entity_extraction_claim_kind" "entity_extraction_claim_kind";--> statement-breakpoint

-- The three fields move together, but the expand phase deliberately does not
-- require them to match the current run or status. An older terminal writer
-- may clear the 0051 run tuple while leaving this new tuple behind, and an
-- older claimer may create a run with no liveness tuple. Current application
-- code treats both shapes as rollout residue and never recovers them.
ALTER TABLE "letters" ADD CONSTRAINT "entity_extraction_lease_metadata_valid"
  CHECK (
    ("entity_extraction_lease_expires_at" IS NULL)
      = ("entity_extraction_lease_run_id" IS NULL)
    AND ("entity_extraction_lease_expires_at" IS NULL)
      = ("entity_extraction_claim_kind" IS NULL)
  ) NOT VALID;--> statement-breakpoint

CREATE INDEX "idx_letters_entity_extraction_lease_expires_at"
  ON "letters" ("entity_extraction_lease_expires_at")
  WHERE "entity_extraction_status" = 'RUNNING'
    AND "entity_extraction_lease_expires_at" IS NOT NULL;--> statement-breakpoint

-- Once a current run has a matching liveness tuple, a same-run RUNNING write
-- may renew only its deadline. This remains rolling-safe: an older writer may
-- still terminate the run and leave the unknown new tuple as residue.
CREATE FUNCTION protect_current_entity_extraction_liveness() RETURNS trigger AS $$
BEGIN
  IF OLD.entity_extraction_status = 'RUNNING'
    AND OLD.entity_extraction_run_id IS NOT NULL
    AND OLD.entity_extraction_lease_expires_at IS NOT NULL
    AND OLD.entity_extraction_lease_run_id = OLD.entity_extraction_run_id
    AND OLD.entity_extraction_claim_kind IS NOT NULL
    AND NEW.entity_extraction_status = 'RUNNING'
    AND NEW.entity_extraction_run_id = OLD.entity_extraction_run_id
    AND (
      NEW.entity_extraction_lease_expires_at IS NULL
      OR NEW.entity_extraction_lease_run_id IS DISTINCT FROM OLD.entity_extraction_lease_run_id
      OR NEW.entity_extraction_claim_kind IS DISTINCT FROM OLD.entity_extraction_claim_kind
    ) THEN
    RAISE EXCEPTION 'current entity extraction RUNNING attempts must preserve liveness ownership'
      USING ERRCODE = '23514',
            CONSTRAINT = 'entity_extraction_running_liveness_cannot_be_stripped';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER entity_extraction_liveness_guard
  BEFORE UPDATE OF
    entity_extraction_status,
    entity_extraction_run_id,
    entity_extraction_lease_expires_at,
    entity_extraction_lease_run_id,
    entity_extraction_claim_kind
  ON "letters"
  FOR EACH ROW
  EXECUTE FUNCTION protect_current_entity_extraction_liveness();
