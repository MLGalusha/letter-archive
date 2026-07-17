CREATE TYPE "public"."transcription_claim_kind" AS ENUM ('QUEUED', 'REQUESTED');

-- JavaScript Date has millisecond precision; matching it in PostgreSQL keeps
-- observed-state compare-and-set equality lossless after a database round trip.
ALTER TABLE "letters" ADD COLUMN "transcription_lease_expires_at" timestamp(3) with time zone;
ALTER TABLE "letters" ADD COLUMN "transcription_claim_kind" "transcription_claim_kind";

-- Rollout compatibility: a RUNNING attempt created before lease-aware code may
-- retain both fields as NULL, while an older binary may finish a leased attempt
-- without clearing these new columns. The metadata therefore travels as a pair,
-- but status/run ownership is enforced by lease-aware compare-and-set writers.
ALTER TABLE "letters" ADD CONSTRAINT "transcription_lease_metadata_valid"
  CHECK (
    ("transcription_lease_expires_at" IS NULL)
    = ("transcription_claim_kind" IS NULL)
  );

-- Old application revisions do not know the new cross-stage claim predicate.
-- Enforce it for every new write during a rolling deployment, while NOT VALID
-- lets an operator explicitly resolve any already-conflicting legacy row.
ALTER TABLE "letters" ADD CONSTRAINT "transcription_excludes_downstream_running"
  CHECK (
    "transcription_status" <> 'RUNNING'
    OR (
      "metadata_status" <> 'RUNNING'
      AND "entity_extraction_status" <> 'RUNNING'
    )
  ) NOT VALID;

CREATE INDEX "idx_letters_transcription_lease_expires_at"
  ON "letters" ("transcription_lease_expires_at")
  WHERE "transcription_status" = 'RUNNING'
    AND "transcription_lease_expires_at" IS NOT NULL;
