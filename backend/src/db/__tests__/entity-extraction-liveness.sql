INSERT INTO collections (id, collection_code)
VALUES (
  '00000000-0000-0000-0000-000000000053',
  'E53'
);

INSERT INTO letters (
  id,
  collection_id,
  date_raw,
  type,
  type_sequence,
  transcription_status,
  metadata_status,
  entity_extraction_status
) VALUES (
  '53000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000053',
  '19000101',
  'L',
  1,
  'SUCCESS',
  'SUCCESS',
  'PENDING'
);

-- Dedicated rows for the two-session lock-ordering regressions in
-- scripts/test-migrations.sh. The shell sets their attempt deadlines
-- immediately before each race so setup time cannot make a test vacuous.
INSERT INTO letters (
  id,
  collection_id,
  date_raw,
  type,
  type_sequence,
  transcription_status,
  metadata_status,
  entity_extraction_status
) VALUES
  (
    '53000000-0000-4000-8000-000000000010',
    '00000000-0000-0000-0000-000000000053',
    '19000102',
    'L',
    1,
    'SUCCESS',
    'SUCCESS',
    'PENDING'
  ),
  (
    '53000000-0000-4000-8000-000000000020',
    '00000000-0000-0000-0000-000000000053',
    '19000103',
    'L',
    1,
    'SUCCESS',
    'SUCCESS',
    'PENDING'
  );

DO $$
DECLARE
  affected integer;
  observed_constraint text;
  queued_run uuid := '53000000-0000-4000-8000-000000000002';
  requested_run uuid := '53000000-0000-4000-8000-000000000003';
  queued_recovery_run uuid := '53000000-0000-4000-8000-000000000008';
  residue_run uuid := '53000000-0000-4000-8000-000000000004';
  replacement_run uuid := '53000000-0000-4000-8000-000000000005';
  mismatched_run uuid := '53000000-0000-4000-8000-000000000006';
  unleased_run uuid := '53000000-0000-4000-8000-000000000007';
BEGIN
  BEGIN
    UPDATE letters
    SET entity_extraction_lease_expires_at =
      clock_timestamp() + interval '5 minutes'
    WHERE id = '53000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'partial entity liveness tuple unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS observed_constraint = CONSTRAINT_NAME;
    IF observed_constraint <> 'entity_extraction_lease_metadata_valid' THEN
      RAISE;
    END IF;
  END;

  UPDATE letters
  SET entity_extraction_status = 'RUNNING',
      entity_extraction_run_id = queued_run,
      entity_extraction_run_revision = entity_extraction_revision + 1,
      entity_extraction_lease_expires_at =
        clock_timestamp() + interval '5 minutes',
      entity_extraction_lease_run_id = queued_run,
      entity_extraction_claim_kind = 'QUEUED'
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'PENDING'
    AND entity_extraction_run_id IS NULL
    AND entity_extraction_run_revision IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'queued entity attempt was not claimed';
  END IF;

  UPDATE letters
  SET entity_extraction_lease_expires_at =
    clock_timestamp() + interval '5 minutes'
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'RUNNING'
    AND entity_extraction_run_id = queued_run
    AND entity_extraction_run_revision = entity_extraction_revision + 1
    AND entity_extraction_lease_run_id = queued_run
    AND entity_extraction_lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'exact live entity owner could not renew';
  END IF;

  BEGIN
    UPDATE letters
    SET entity_extraction_lease_expires_at = NULL,
        entity_extraction_lease_run_id = NULL,
        entity_extraction_claim_kind = NULL
    WHERE id = '53000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'current RUNNING entity liveness was stripped';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS observed_constraint = CONSTRAINT_NAME;
    IF observed_constraint
      <> 'entity_extraction_running_liveness_cannot_be_stripped' THEN
      RAISE;
    END IF;
  END;

  UPDATE letters
  SET entity_extraction_status = 'FAILED',
      entity_extraction_run_id = NULL,
      entity_extraction_run_revision = NULL,
      entity_extraction_lease_expires_at = NULL,
      entity_extraction_lease_run_id = NULL,
      entity_extraction_claim_kind = NULL,
      entity_extraction_error = 'exact failure'
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'RUNNING'
    AND entity_extraction_run_id = queued_run
    AND entity_extraction_run_revision = entity_extraction_revision + 1
    AND entity_extraction_lease_run_id = queued_run
    AND entity_extraction_lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'exact live entity owner could not fail';
  END IF;

  UPDATE letters
  SET entity_extraction_status = 'PENDING',
      entity_extraction_error = NULL
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'FAILED';

  UPDATE letters
  SET entity_extraction_status = 'RUNNING',
      entity_extraction_run_id = queued_recovery_run,
      entity_extraction_run_revision = entity_extraction_revision + 1,
      entity_extraction_lease_expires_at =
        clock_timestamp() - interval '1 second',
      entity_extraction_lease_run_id = queued_recovery_run,
      entity_extraction_claim_kind = 'QUEUED'
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'PENDING';

  UPDATE letters
  SET entity_extraction_status = 'PENDING',
      entity_extraction_run_id = NULL,
      entity_extraction_run_revision = NULL,
      entity_extraction_lease_expires_at = NULL,
      entity_extraction_lease_run_id = NULL,
      entity_extraction_claim_kind = NULL,
      entity_extraction_error = NULL
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'RUNNING'
    AND entity_extraction_run_id = queued_recovery_run
    AND entity_extraction_run_revision = entity_extraction_revision + 1
    AND entity_extraction_lease_run_id = entity_extraction_run_id
    AND entity_extraction_claim_kind = 'QUEUED'
    AND entity_extraction_lease_expires_at <= clock_timestamp();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'expired queued entity attempt was not requeued';
  END IF;

  UPDATE letters
  SET entity_extraction_status = 'FAILED'
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'RUNNING'
    AND entity_extraction_run_id = queued_recovery_run;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'a second reconciler recovered the same entity attempt';
  END IF;

  UPDATE letters
  SET entity_extraction_status = 'RUNNING',
      entity_extraction_run_id = requested_run,
      entity_extraction_run_revision = entity_extraction_revision + 1,
      entity_extraction_lease_expires_at =
        clock_timestamp() - interval '1 second',
      entity_extraction_lease_run_id = requested_run,
      entity_extraction_claim_kind = 'REQUESTED',
      entity_extraction_error = NULL
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'PENDING';

  UPDATE letters
  SET entity_extraction_status = 'FAILED',
      entity_extraction_run_id = NULL,
      entity_extraction_run_revision = NULL,
      entity_extraction_lease_expires_at = NULL,
      entity_extraction_lease_run_id = NULL,
      entity_extraction_claim_kind = NULL,
      entity_extraction_error =
        'Entity extraction lease expired before the attempt completed'
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'RUNNING'
    AND entity_extraction_run_id = requested_run
    AND entity_extraction_run_revision = entity_extraction_revision + 1
    AND entity_extraction_lease_run_id = entity_extraction_run_id
    AND entity_extraction_claim_kind = 'REQUESTED'
    AND entity_extraction_lease_expires_at <= clock_timestamp();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'expired requested entity attempt was not failed';
  END IF;

  -- A current leased attempt may be terminated by an older 0051-aware binary,
  -- which clears only the run tuple. Migration 0053 must allow that rolling
  -- shape and leave its complete liveness tuple as non-authoritative residue.
  UPDATE letters
  SET entity_extraction_status = 'RUNNING',
      entity_extraction_run_id = residue_run,
      entity_extraction_run_revision = entity_extraction_revision + 1,
      entity_extraction_lease_expires_at =
        clock_timestamp() + interval '5 minutes',
      entity_extraction_lease_run_id = residue_run,
      entity_extraction_claim_kind = 'QUEUED',
      entity_extraction_error = NULL
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'FAILED';

  UPDATE letters
  SET entity_extraction_status = 'FAILED',
      entity_extraction_run_id = NULL,
      entity_extraction_run_revision = NULL,
      entity_extraction_error = 'old terminal writer'
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_run_id = residue_run;

  IF NOT EXISTS (
    SELECT 1
    FROM letters
    WHERE id = '53000000-0000-4000-8000-000000000001'
      AND entity_extraction_status = 'FAILED'
      AND entity_extraction_run_id IS NULL
      AND entity_extraction_run_revision IS NULL
      AND entity_extraction_lease_run_id = residue_run
      AND entity_extraction_claim_kind = 'QUEUED'
  ) THEN
    RAISE EXCEPTION 'rolling terminal residue was not preserved';
  END IF;

  UPDATE letters
  SET entity_extraction_status = 'RUNNING',
      entity_extraction_run_id = replacement_run,
      entity_extraction_run_revision = entity_extraction_revision + 1,
      entity_extraction_lease_expires_at =
        clock_timestamp() + interval '5 minutes',
      entity_extraction_lease_run_id = replacement_run,
      entity_extraction_claim_kind = 'REQUESTED',
      entity_extraction_error = NULL
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'FAILED'
    AND entity_extraction_run_id IS NULL
    AND entity_extraction_run_revision IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'current claim could not overwrite rolling residue';
  END IF;

  UPDATE letters
  SET entity_extraction_status = 'SUCCESS',
      entity_extraction_revision = entity_extraction_run_revision,
      entity_extraction_run_id = NULL,
      entity_extraction_run_revision = NULL,
      entity_extraction_lease_expires_at = NULL,
      entity_extraction_lease_run_id = NULL,
      entity_extraction_claim_kind = NULL,
      entity_extraction_json = '{"people":[],"places":[]}'::jsonb
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'RUNNING'
    AND entity_extraction_run_id = replacement_run
    AND entity_extraction_lease_run_id = replacement_run
    AND entity_extraction_lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'exact live entity owner could not publish';
  END IF;

  -- Fully bound but mismatched rollout residue and pre-lease runs remain
  -- explicit/manual; expiry alone cannot infer their intent.
  UPDATE letters
  SET entity_extraction_status = 'RUNNING',
      entity_extraction_run_id = mismatched_run,
      entity_extraction_run_revision = entity_extraction_revision + 1,
      entity_extraction_lease_expires_at =
        clock_timestamp() - interval '1 second',
      entity_extraction_lease_run_id = queued_run,
      entity_extraction_claim_kind = 'QUEUED'
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'SUCCESS';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'mismatched rollout attempt setup did not run';
  END IF;

  UPDATE letters
  SET entity_extraction_status = 'PENDING',
      entity_extraction_run_id = NULL,
      entity_extraction_run_revision = NULL,
      entity_extraction_lease_expires_at = NULL,
      entity_extraction_lease_run_id = NULL,
      entity_extraction_claim_kind = NULL
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'RUNNING'
    AND entity_extraction_run_id = mismatched_run
    AND entity_extraction_run_revision = entity_extraction_revision + 1
    AND entity_extraction_lease_run_id = entity_extraction_run_id
    AND entity_extraction_claim_kind = 'QUEUED'
    AND entity_extraction_lease_expires_at <= clock_timestamp();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'mismatched rollout attempt was recovered automatically';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM letters
    WHERE id = '53000000-0000-4000-8000-000000000001'
      AND entity_extraction_status = 'RUNNING'
      AND entity_extraction_run_id = mismatched_run
      AND entity_extraction_run_revision = entity_extraction_revision + 1
      AND entity_extraction_lease_run_id = queued_run
      AND entity_extraction_claim_kind = 'QUEUED'
  ) THEN
    RAISE EXCEPTION 'mismatched rollout attempt did not remain manual';
  END IF;

  UPDATE letters
  SET entity_extraction_status = 'FAILED',
      entity_extraction_run_id = NULL,
      entity_extraction_run_revision = NULL,
      entity_extraction_lease_expires_at = NULL,
      entity_extraction_lease_run_id = NULL,
      entity_extraction_claim_kind = NULL
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'RUNNING'
    AND entity_extraction_run_id = mismatched_run;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'mismatched rollout attempt cleanup did not run';
  END IF;

  UPDATE letters
  SET entity_extraction_status = 'RUNNING',
      entity_extraction_run_id = unleased_run,
      entity_extraction_run_revision = entity_extraction_revision + 1
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'FAILED';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'unleased rollout attempt setup did not run';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM letters
    WHERE id = '53000000-0000-4000-8000-000000000001'
      AND entity_extraction_status = 'RUNNING'
      AND entity_extraction_run_id = unleased_run
      AND entity_extraction_run_revision = entity_extraction_revision + 1
      AND entity_extraction_lease_expires_at IS NULL
      AND entity_extraction_lease_run_id IS NULL
      AND entity_extraction_claim_kind IS NULL
  ) THEN
    RAISE EXCEPTION 'unleased rollout attempt shape was not persisted';
  END IF;

  UPDATE letters
  SET entity_extraction_status = 'PENDING',
      entity_extraction_run_id = NULL,
      entity_extraction_run_revision = NULL
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'RUNNING'
    AND entity_extraction_run_id = unleased_run
    AND entity_extraction_lease_expires_at <= clock_timestamp();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'unleased rollout attempt was recovered automatically';
  END IF;

  UPDATE letters
  SET entity_extraction_status = 'FAILED',
      entity_extraction_run_id = NULL,
      entity_extraction_run_revision = NULL
  WHERE id = '53000000-0000-4000-8000-000000000001'
    AND entity_extraction_status = 'RUNNING'
    AND entity_extraction_run_id = unleased_run;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'unleased rollout attempt cleanup did not run';
  END IF;
END $$;
