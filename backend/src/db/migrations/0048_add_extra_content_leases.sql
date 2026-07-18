CREATE TYPE "public"."extra_content_claim_kind" AS ENUM ('QUEUED', 'REQUESTED');

-- JavaScript Date has millisecond precision; matching it in PostgreSQL keeps
-- observed-state compare-and-set equality lossless after a database round trip.
ALTER TABLE "letters" ADD COLUMN "extra_content_job_lease_expires_at" timestamp(3) with time zone;
ALTER TABLE "letters" ADD COLUMN "extra_content_job_lease_run_id" uuid;
ALTER TABLE "letters" ADD COLUMN "extra_content_job_claim_kind" "extra_content_claim_kind";

-- Rollout compatibility: a RUNNING attempt created before lease-aware code may
-- retain all fields as NULL, while an older binary may finish a leased attempt
-- without clearing them. Binding the lease to its run ID also makes a later run
-- started by that older binary ignore inherited stale metadata during recovery.
ALTER TABLE "letters" ADD CONSTRAINT "extra_content_job_lease_metadata_valid"
  CHECK (
    ("extra_content_job_lease_expires_at" IS NULL)
    = ("extra_content_job_lease_run_id" IS NULL)
    AND ("extra_content_job_lease_expires_at" IS NULL)
    = ("extra_content_job_claim_kind" IS NULL)
  );

CREATE INDEX "idx_letters_extra_content_job_lease_expires_at"
  ON "letters" ("extra_content_job_lease_expires_at")
  WHERE "extra_content_job_status" = 'RUNNING'
    AND "extra_content_job_lease_expires_at" IS NOT NULL;
