INSERT INTO collections (id, collection_code)
VALUES (
  '55000000-0000-4000-8000-000000000000',
  'T55'
);

INSERT INTO letters (
  id,
  collection_id,
  date_raw,
  type,
  type_sequence,
  workflow,
  primary_source_revision,
  transcript_status,
  transcription_status,
  transcription_text,
  metadata_status,
  metadata_revision,
  entity_extraction_status,
  transcript_confirmed_at,
  transcript_confirmed_by,
  transcript_confirmation_id,
  transcript_confirmation_intent_hash,
  transcript_confirmation_source_revision,
  transcript_confirmation_transcript_digest,
  metadata_confirmation_guidance
) VALUES (
  '55000000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000000',
  '19000101',
  'L',
  1,
  'TRANSCRIBED',
  0,
  'EDITED',
  'SUCCESS',
  'Reviewed transcript',
  'PENDING',
  0,
  'PENDING',
  '2026-07-25 12:00:00+00',
  'current-reviewer',
  '55000000-0000-4000-8000-000000000002',
  'v1.2222222222222222222222222222222222222222222222222222222222222222',
  0,
  '3333333333333333333333333333333333333333333333333333333333333333',
  '{
    "version": 1,
    "confirmationId": "55000000-0000-4000-8000-000000000002",
    "metadataInputIdentity":
      "v1.1111111111111111111111111111111111111111111111111111111111111111",
    "confirmedSender": "Mabel Hart",
    "confirmedRecipient": null
  }'::jsonb
);

DO $$
DECLARE
  legacy_run uuid := '55000000-0000-4000-8000-000000000003';
  current_run uuid := '55000000-0000-4000-8000-000000000004';
BEGIN
  -- The immediately previous API combined its legacy confirmation stamp and
  -- metadata claim in one UPDATE. It does not know metadata_guidance_run_id.
  -- The trigger must reject that whole statement before it can retire the new
  -- identity/guidance and satisfy the final row checks accidentally.
  BEGIN
    UPDATE letters
    SET transcript_confirmed_at = '2026-07-25 12:01:00+00',
        transcript_confirmed_by = 'legacy-reviewer',
        metadata_status = 'RUNNING',
        metadata_run_id = legacy_run,
        metadata_run_revision = metadata_revision,
        metadata_lease_expires_at =
          clock_timestamp() + interval '5 minutes',
        metadata_lease_run_id = legacy_run,
        metadata_claim_kind = 'QUEUED'
    WHERE id = '55000000-0000-4000-8000-000000000001';

    RAISE EXCEPTION
      'legacy combined confirmation and metadata claim unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM letters
    WHERE id = '55000000-0000-4000-8000-000000000001'
      AND transcript_confirmed_at = '2026-07-25 12:00:00+00'
      AND transcript_confirmed_by = 'current-reviewer'
      AND transcript_confirmation_id =
        '55000000-0000-4000-8000-000000000002'
      AND metadata_confirmation_guidance IS NOT NULL
      AND metadata_guidance_run_id IS NULL
      AND metadata_status = 'PENDING'
      AND metadata_run_id IS NULL
      AND metadata_run_revision IS NULL
      AND metadata_lease_expires_at IS NULL
      AND metadata_lease_run_id IS NULL
      AND metadata_claim_kind IS NULL
  ) THEN
    RAISE EXCEPTION
      'rejected legacy claim did not preserve the exact guided queued row';
  END IF;

  -- A current worker can claim the same queued row only by binding the durable
  -- guidance to its exact run.
  UPDATE letters
  SET metadata_status = 'RUNNING',
      metadata_run_id = current_run,
      metadata_run_revision = metadata_revision,
      metadata_lease_expires_at =
        clock_timestamp() + interval '5 minutes',
      metadata_lease_run_id = current_run,
      metadata_claim_kind = 'QUEUED',
      metadata_guidance_run_id = current_run
  WHERE id = '55000000-0000-4000-8000-000000000001'
    AND metadata_status = 'PENDING';

  IF NOT EXISTS (
    SELECT 1
    FROM letters
    WHERE id = '55000000-0000-4000-8000-000000000001'
      AND metadata_status = 'RUNNING'
      AND metadata_run_id = current_run
      AND metadata_lease_run_id = current_run
      AND metadata_guidance_run_id = current_run
      AND metadata_confirmation_guidance IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'current worker could not claim and bind the guided queued row';
  END IF;
END $$;
