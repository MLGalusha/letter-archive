-- Expand phase for revision-bound metadata attempts. Older revisions may have
-- already created tokenless RUNNING rows, so an entirely empty ownership tuple
-- remains valid until those executors and rows have been drained.
CREATE TYPE "public"."metadata_claim_kind" AS ENUM ('QUEUED', 'REQUESTED');

ALTER TABLE "letters" ADD COLUMN "metadata_revision" integer DEFAULT 0 NOT NULL;
ALTER TABLE "letters" ADD COLUMN "metadata_run_id" uuid;
ALTER TABLE "letters" ADD COLUMN "metadata_run_revision" integer;
ALTER TABLE "letters" ADD COLUMN "metadata_lease_expires_at" timestamp(3) with time zone;
ALTER TABLE "letters" ADD COLUMN "metadata_lease_run_id" uuid;
ALTER TABLE "letters" ADD COLUMN "metadata_claim_kind" "metadata_claim_kind";

-- NOT VALID avoids scanning the whole letters table while the deployment holds
-- its DDL lock. PostgreSQL still enforces both checks for every subsequent write.
ALTER TABLE "letters" ADD CONSTRAINT "metadata_revision_nonnegative"
  CHECK ("metadata_revision" >= 0) NOT VALID;
ALTER TABLE "letters" ADD CONSTRAINT "metadata_owner_shape" CHECK (
  (
    "metadata_run_id" IS NULL
    AND "metadata_run_revision" IS NULL
    AND "metadata_lease_expires_at" IS NULL
    AND "metadata_lease_run_id" IS NULL
    AND "metadata_claim_kind" IS NULL
  ) OR (
    "metadata_status" = 'RUNNING'
    AND "metadata_run_id" IS NOT NULL
    AND "metadata_run_revision" IS NOT NULL
    AND "metadata_run_revision" = "metadata_revision"
    AND "metadata_lease_expires_at" IS NOT NULL
    AND "metadata_lease_run_id" = "metadata_run_id"
    AND "metadata_claim_kind" IS NOT NULL
  )
) NOT VALID;

CREATE INDEX "idx_letters_metadata_lease_expires_at"
  ON "letters" ("metadata_lease_expires_at")
  WHERE "metadata_status" = 'RUNNING'
    AND "metadata_lease_expires_at" IS NOT NULL;

-- Current writers advance metadata_revision whenever a non-claim lifecycle
-- transition commits. Legacy tokenless RUNNING attempts may finish during the
-- rollout drain, but once superseded they cannot rewrite a newer terminal row.
CREATE FUNCTION enforce_metadata_status_transition() RETURNS trigger AS $$
BEGIN
  -- Once a current owner exists, no writer may silently convert it back into
  -- rollout-era tokenless RUNNING state. Heartbeats may move only the expiry;
  -- normal completion/supersession changes status and clears the whole tuple.
  IF TG_OP = 'UPDATE'
    AND OLD.metadata_status = 'RUNNING'
    AND OLD.metadata_run_id IS NOT NULL
    AND NEW.metadata_status = 'RUNNING'
    AND (
      NEW.metadata_run_id IS DISTINCT FROM OLD.metadata_run_id
      OR NEW.metadata_run_revision IS DISTINCT FROM OLD.metadata_run_revision
      OR NEW.metadata_lease_run_id IS DISTINCT FROM OLD.metadata_lease_run_id
      OR NEW.metadata_claim_kind IS DISTINCT FROM OLD.metadata_claim_kind
      OR NEW.metadata_lease_expires_at IS NULL
    ) THEN
    RAISE EXCEPTION 'owned metadata RUNNING attempts must preserve ownership'
      USING ERRCODE = '23514',
            CONSTRAINT = 'metadata_running_owner_cannot_be_stripped';
  END IF;

  IF NEW.metadata_status = 'RUNNING'
    AND (TG_OP = 'INSERT' OR OLD.metadata_status <> 'RUNNING')
    AND NEW.metadata_run_id IS NULL THEN
    RAISE EXCEPTION 'new metadata RUNNING transitions require ownership'
      USING ERRCODE = '23514',
            CONSTRAINT = 'metadata_running_requires_owner';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.metadata_status = 'RUNNING'
    AND OLD.metadata_run_id IS NOT NULL
    AND NEW.metadata_status <> 'RUNNING'
    AND NOT (
      NEW.metadata_run_id IS NULL
      AND NEW.metadata_run_revision IS NULL
      AND NEW.metadata_lease_expires_at IS NULL
      AND NEW.metadata_lease_run_id IS NULL
      AND NEW.metadata_claim_kind IS NULL
      AND NEW.metadata_revision = OLD.metadata_revision + 1
    ) THEN
    RAISE EXCEPTION 'owned metadata terminal transitions require a revision advance'
      USING ERRCODE = '23514',
            CONSTRAINT = 'metadata_terminal_requires_revision';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.metadata_status <> 'RUNNING'
    AND NEW.metadata_status <> 'RUNNING'
    AND NEW.metadata_status <> OLD.metadata_status
    AND NOT (
      NEW.metadata_run_id IS NULL
      AND NEW.metadata_run_revision IS NULL
      AND NEW.metadata_lease_expires_at IS NULL
      AND NEW.metadata_lease_run_id IS NULL
      AND NEW.metadata_claim_kind IS NULL
      AND NEW.metadata_revision = OLD.metadata_revision + 1
      AND (
        NEW.metadata_status <> 'SUCCESS'
        OR NEW.metadata_content_status = 'EDITED'
      )
    ) THEN
    RAISE EXCEPTION 'metadata status changes require a revision advance'
      USING ERRCODE = '23514',
            CONSTRAINT = 'metadata_status_change_requires_revision';
  END IF;

  -- Older producers commonly issue SUCCESS -> SUCCESS as an unconditional
  -- terminal write. Requiring a revision advance distinguishes current human
  -- edits from a drained producer trying to replace a newer successful result.
  IF TG_OP = 'UPDATE'
    AND OLD.metadata_status = 'SUCCESS'
    AND NEW.metadata_status = 'SUCCESS'
    AND NEW.metadata_revision <> OLD.metadata_revision + 1 THEN
    RAISE EXCEPTION 'metadata SUCCESS rewrites require a revision advance'
      USING ERRCODE = '23514',
            CONSTRAINT = 'metadata_success_rewrite_requires_revision';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER metadata_status_transition_guard
  BEFORE INSERT OR UPDATE OF
    metadata_status,
    metadata_run_id,
    metadata_run_revision,
    metadata_lease_expires_at,
    metadata_lease_run_id,
    metadata_claim_kind
  ON "letters"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_metadata_status_transition();

-- While an ownership-aware run is active, an older application revision must
-- not mutate one of that run's inputs or committed metadata in place. Current
-- writers supersede the run by clearing its owner tuple and advancing the
-- revision in the same statement. This metadata-specific guard replaces the
-- overly broad updated_at publication fence, so unrelated row edits remain
-- independent from extraction.
CREATE FUNCTION protect_owned_metadata_attempt() RETURNS trigger AS $$
BEGIN
  IF OLD.metadata_status = 'RUNNING'
    AND OLD.metadata_run_id IS NOT NULL
    AND NEW.metadata_status = 'RUNNING'
    AND NEW.metadata_run_id = OLD.metadata_run_id
    AND NEW.metadata_revision = OLD.metadata_revision
    AND ROW(
      NEW.type,
      NEW.collection_id,
      NEW.letter_date,
      NEW.date_raw,
      NEW.transcription_text,
      NEW.transcript_confirmed_at,
      NEW.extra_content_transcript,
      NEW.sender,
      NEW.recipient,
      NEW.location_written,
      NEW.extracted_date,
      NEW.hook,
      NEW.summary,
      NEW.tags,
      NEW.metadata_json,
      NEW.emotional_tone,
      NEW.sender_recipient_relationship,
      NEW.primary_topics,
      NEW.metadata_v2_json,
      NEW.metadata_content_status,
      NEW.metadata_verified_at,
      NEW.metadata_verified_by,
      NEW.ai_notes
    ) IS DISTINCT FROM ROW(
      OLD.type,
      OLD.collection_id,
      OLD.letter_date,
      OLD.date_raw,
      OLD.transcription_text,
      OLD.transcript_confirmed_at,
      OLD.extra_content_transcript,
      OLD.sender,
      OLD.recipient,
      OLD.location_written,
      OLD.extracted_date,
      OLD.hook,
      OLD.summary,
      OLD.tags,
      OLD.metadata_json,
      OLD.emotional_tone,
      OLD.sender_recipient_relationship,
      OLD.primary_topics,
      OLD.metadata_v2_json,
      OLD.metadata_content_status,
      OLD.metadata_verified_at,
      OLD.metadata_verified_by,
      OLD.ai_notes
    ) THEN
    RAISE EXCEPTION 'metadata inputs cannot change without superseding the active run'
      USING ERRCODE = '23514',
            CONSTRAINT = 'metadata_owned_run_requires_supersession';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER metadata_owned_attempt_input_guard
  BEFORE UPDATE OF
    "type",
    "collection_id",
    "letter_date",
    "date_raw",
    "transcription_text",
    "transcript_confirmed_at",
    "extra_content_transcript",
    "sender",
    "recipient",
    "location_written",
    "extracted_date",
    "hook",
    "summary",
    "tags",
    "metadata_json",
    "emotional_tone",
    "sender_recipient_relationship",
    "primary_topics",
    "metadata_v2_json",
    "metadata_content_status",
    "metadata_verified_at",
    "metadata_verified_by",
    "ai_notes"
  ON "letters"
  FOR EACH ROW
  EXECUTE FUNCTION protect_owned_metadata_attempt();
