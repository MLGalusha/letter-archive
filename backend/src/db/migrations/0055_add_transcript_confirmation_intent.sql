-- Expand-only persistence for durable transcript-confirmation intent. Legacy
-- confirmations and metadata attempts have unknown provenance, so every new
-- column remains nullable and no historical identity or guidance is inferred.
ALTER TABLE "letters" ADD COLUMN "transcript_confirmation_id" uuid;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "transcript_confirmation_intent_hash" text;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "transcript_confirmation_source_revision" integer;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "transcript_confirmation_transcript_digest" text;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "metadata_confirmation_guidance" jsonb;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "metadata_guidance_run_id" uuid;--> statement-breakpoint

-- A null identity tuple is the deliberate legacy shape. Once an identity is
-- assigned, all exact-source fields and the established confirmation timestamp
-- must be present together.
ALTER TABLE "letters"
  ADD CONSTRAINT "transcript_confirmation_identity_shape"
  CHECK (
    (
      "transcript_confirmation_id" IS NULL
      AND "transcript_confirmation_intent_hash" IS NULL
      AND "transcript_confirmation_source_revision" IS NULL
      AND "transcript_confirmation_transcript_digest" IS NULL
    ) OR (
      "transcript_confirmed_at" IS NOT NULL
      AND "transcript_confirmation_id" IS NOT NULL
      AND "transcript_confirmation_intent_hash" IS NOT NULL
      AND "transcript_confirmation_source_revision" IS NOT NULL
      AND "transcript_confirmation_transcript_digest" IS NOT NULL
    )
  ) NOT VALID;--> statement-breakpoint

ALTER TABLE "letters"
  ADD CONSTRAINT "transcript_confirmation_hashes_valid"
  CHECK (
    (
      "transcript_confirmation_intent_hash" IS NULL
      OR "transcript_confirmation_intent_hash" ~ '^v1[.][0-9a-f]{64}$'
    )
    AND (
      "transcript_confirmation_transcript_digest" IS NULL
      OR "transcript_confirmation_transcript_digest" ~ '^[0-9a-f]{64}$'
    )
  ) NOT VALID;--> statement-breakpoint

ALTER TABLE "letters"
  ADD CONSTRAINT "transcript_confirmation_source_revision_nonnegative"
  CHECK (
    "transcript_confirmation_source_revision" IS NULL
    OR "transcript_confirmation_source_revision" >= 0
  ) NOT VALID;--> statement-breakpoint

-- New confirmation-created work always stores this exact versioned envelope,
-- including the all-null guidance case. Unknown keys are rejected so a worker
-- cannot silently interpret a newer envelope as the current contract.
ALTER TABLE "letters"
  ADD CONSTRAINT "metadata_confirmation_guidance_shape"
  CHECK (
    (
      "metadata_confirmation_guidance" IS NULL
      OR (
        "transcript_confirmation_id" IS NOT NULL
        AND jsonb_typeof("metadata_confirmation_guidance") = 'object'
        AND "metadata_confirmation_guidance"
          ?& ARRAY[
            'version',
            'confirmationId',
            'metadataInputIdentity',
            'confirmedSender',
            'confirmedRecipient'
          ]
        AND "metadata_confirmation_guidance"
          - ARRAY[
            'version',
            'confirmationId',
            'metadataInputIdentity',
            'confirmedSender',
            'confirmedRecipient'
          ] = '{}'::jsonb
        AND "metadata_confirmation_guidance"->'version' = '1'::jsonb
        AND "metadata_confirmation_guidance"->>'confirmationId'
          = "transcript_confirmation_id"::text
        AND "metadata_confirmation_guidance"->>'metadataInputIdentity'
          ~ '^v1[.][0-9a-f]{64}$'
        AND jsonb_typeof("metadata_confirmation_guidance"->'confirmedSender')
          IN ('string', 'null')
        AND jsonb_typeof("metadata_confirmation_guidance"->'confirmedRecipient')
          IN ('string', 'null')
      )
    )
    AND (
      "metadata_confirmation_guidance" IS NOT NULL
      OR "metadata_guidance_run_id" IS NULL
    )
  ) NOT VALID;--> statement-breakpoint

-- Rollout gate: a guidance-unaware worker can populate the established 0050
-- metadata owner tuple, but it cannot move a guided row to RUNNING without
-- binding that guidance to the exact same run.
ALTER TABLE "letters"
  ADD CONSTRAINT "metadata_guidance_running_bound_to_run"
  CHECK (
    "metadata_confirmation_guidance" IS NULL
    OR "metadata_status" <> 'RUNNING'
    OR (
      "metadata_guidance_run_id" IS NOT NULL
      AND "metadata_run_id" IS NOT NULL
      AND "metadata_guidance_run_id" = "metadata_run_id"
    )
  ) NOT VALID;--> statement-breakpoint

CREATE UNIQUE INDEX "letters_transcript_confirmation_id_unique"
  ON "letters" ("transcript_confirmation_id")
  WHERE "transcript_confirmation_id" IS NOT NULL;--> statement-breakpoint

-- Source changes make the immutable transcript-confirmation identity stale.
-- A legacy API may rewrite the old confirmation timestamp/by fields without
-- understanding the new identity; retire that identity instead of returning a
-- mutated immutable receipt. Other metadata-provider input changes retain the
-- accepted confirmation but retire its guidance. Entity success is the exact
-- terminal consumer boundary for guidance retained across deferred extraction.
CREATE FUNCTION clear_stale_transcript_confirmation_guidance() RETURNS trigger AS $$
BEGIN
  -- A guidance-unaware writer may change the receipt or provider input without
  -- revoking the active consumer. New writers supersede the owner in the same
  -- UPDATE; reject legacy writes that would let stale guided work publish.
  IF OLD.metadata_confirmation_guidance IS NOT NULL
    AND (
      (
        NEW.metadata_status = 'RUNNING'
      )
      OR NEW.entity_extraction_status = 'RUNNING'
    )
    AND (
      NEW.transcript_confirmed_at IS NULL
      OR NEW.primary_source_revision IS DISTINCT FROM OLD.primary_source_revision
      OR NEW.transcription_text IS DISTINCT FROM OLD.transcription_text
      OR (
        OLD.transcript_confirmation_id IS NOT NULL
        AND (
          NEW.transcript_confirmed_at IS DISTINCT FROM OLD.transcript_confirmed_at
          OR NEW.transcript_confirmed_by IS DISTINCT FROM OLD.transcript_confirmed_by
        )
      )
      OR ROW(
        NEW.type,
        NEW.collection_id,
        NEW.letter_date,
        NEW.date_raw,
        NEW.extra_content_transcript,
        NEW.extra_content_status,
        NEW.extra_content_job_status
      ) IS DISTINCT FROM ROW(
        OLD.type,
        OLD.collection_id,
        OLD.letter_date,
        OLD.date_raw,
        OLD.extra_content_transcript,
        OLD.extra_content_status,
        OLD.extra_content_job_status
      )
    ) THEN
    RAISE EXCEPTION
      'cannot change guided metadata input without superseding its active consumer'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.transcript_confirmed_at IS NULL
    OR NEW.primary_source_revision IS DISTINCT FROM OLD.primary_source_revision
    OR NEW.transcription_text IS DISTINCT FROM OLD.transcription_text
    OR (
      OLD.transcript_confirmation_id IS NOT NULL
      AND (
        NEW.transcript_confirmed_at IS DISTINCT FROM OLD.transcript_confirmed_at
        OR NEW.transcript_confirmed_by IS DISTINCT FROM OLD.transcript_confirmed_by
      )
    ) THEN
    NEW.transcript_confirmation_id := NULL;
    NEW.transcript_confirmation_intent_hash := NULL;
    NEW.transcript_confirmation_source_revision := NULL;
    NEW.transcript_confirmation_transcript_digest := NULL;
    NEW.metadata_confirmation_guidance := NULL;
    NEW.metadata_guidance_run_id := NULL;
  ELSIF ROW(
      NEW.type,
      NEW.collection_id,
      NEW.letter_date,
      NEW.date_raw,
      NEW.extra_content_transcript,
      NEW.extra_content_status,
      NEW.extra_content_job_status
    ) IS DISTINCT FROM ROW(
      OLD.type,
      OLD.collection_id,
      OLD.letter_date,
      OLD.date_raw,
      OLD.extra_content_transcript,
      OLD.extra_content_status,
      OLD.extra_content_job_status
    )
    OR (
      NEW.entity_extraction_status = 'SUCCESS'
      AND OLD.entity_extraction_status IS DISTINCT FROM 'SUCCESS'
    ) THEN
    NEW.metadata_confirmation_guidance := NULL;
    NEW.metadata_guidance_run_id := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER transcript_confirmation_guidance_invalidation_guard
  BEFORE UPDATE OF
    transcript_confirmed_at,
    transcript_confirmed_by,
    primary_source_revision,
    transcription_text,
    type,
    collection_id,
    letter_date,
    date_raw,
    extra_content_transcript,
    extra_content_status,
    extra_content_job_status,
    entity_extraction_status
  ON "letters"
  FOR EACH ROW
  EXECUTE FUNCTION clear_stale_transcript_confirmation_guidance();
