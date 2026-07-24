-- This fixture runs only after scripts/test-migrations.sh has:
--   1. applied migrations through 0050,
--   2. seeded a tokenless RUNNING attempt,
--   3. applied 0051 and 0052,
--   4. created a 0051-owned RUNNING attempt without liveness metadata, and
--   5. applied 0053 over both active rows.
DO $$
DECLARE
  affected integer;
  tokenless_id uuid := '53000000-0000-4000-8000-000000000100';
  owned_id uuid := '53000000-0000-4000-8000-000000000101';
  post_migration_id uuid := '53000000-0000-4000-8000-000000000103';
  owned_run uuid := '53000000-0000-4000-8000-000000000102';
  post_migration_run uuid := '53000000-0000-4000-8000-000000000104';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM letters
    WHERE id = tokenless_id
      AND entity_extraction_status = 'RUNNING'
      AND entity_extraction_run_id IS NULL
      AND entity_extraction_run_revision IS NULL
      AND entity_extraction_lease_expires_at IS NULL
      AND entity_extraction_lease_run_id IS NULL
      AND entity_extraction_claim_kind IS NULL
  ) THEN
    RAISE EXCEPTION 'pre-0051 tokenless attempt did not survive migration 0053';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM letters
    WHERE id = owned_id
      AND entity_extraction_status = 'RUNNING'
      AND entity_extraction_revision = 0
      AND entity_extraction_run_id = owned_run
      AND entity_extraction_run_revision = 1
      AND entity_extraction_lease_expires_at IS NULL
      AND entity_extraction_lease_run_id IS NULL
      AND entity_extraction_claim_kind IS NULL
  ) THEN
    RAISE EXCEPTION '0051-owned attempt did not survive migration 0053';
  END IF;

  -- Current expiry recovery must not infer intent for either old shape.
  UPDATE letters
  SET entity_extraction_status = 'PENDING',
      entity_extraction_run_id = NULL,
      entity_extraction_run_revision = NULL,
      entity_extraction_lease_expires_at = NULL,
      entity_extraction_lease_run_id = NULL,
      entity_extraction_claim_kind = NULL
  WHERE id IN (tokenless_id, owned_id)
    AND entity_extraction_status = 'RUNNING'
    AND entity_extraction_run_id IS NOT NULL
    AND entity_extraction_run_revision = entity_extraction_revision + 1
    AND entity_extraction_lease_expires_at IS NOT NULL
    AND entity_extraction_lease_run_id = entity_extraction_run_id
    AND entity_extraction_claim_kind = 'QUEUED'
    AND entity_extraction_lease_expires_at <= clock_timestamp();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'migration-era attempts were recovered automatically';
  END IF;

  -- A pre-0051 producer drains through the legacy 0051 commit path after 0053.
  UPDATE letters
  SET entity_extraction_status = 'SUCCESS',
      entity_extraction_json = '{"people":[],"places":[]}'::jsonb
  WHERE id = tokenless_id
    AND entity_extraction_status = 'RUNNING'
    AND entity_extraction_run_id IS NULL
    AND entity_extraction_run_revision IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'pre-0051 tokenless producer could not drain after 0053';
  END IF;

  -- A 0051-aware producer drains its exact owner while omitting every 0053
  -- column, exactly as an old deployed binary would.
  UPDATE letters
  SET entity_extraction_status = 'SUCCESS',
      entity_extraction_json = '{"people":[],"places":[]}'::jsonb,
      entity_extraction_revision = entity_extraction_run_revision,
      entity_extraction_run_id = NULL,
      entity_extraction_run_revision = NULL
  WHERE id = owned_id
    AND entity_extraction_status = 'RUNNING'
    AND entity_extraction_run_id = owned_run
    AND entity_extraction_run_revision = entity_extraction_revision + 1;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION '0051-owned producer could not drain after 0053';
  END IF;

  IF (
    SELECT count(*)
    FROM letters
    WHERE id IN (tokenless_id, owned_id)
      AND entity_extraction_status = 'SUCCESS'
      AND entity_extraction_revision = 1
      AND entity_extraction_run_id IS NULL
      AND entity_extraction_run_revision IS NULL
      AND entity_extraction_lease_expires_at IS NULL
      AND entity_extraction_lease_run_id IS NULL
      AND entity_extraction_claim_kind IS NULL
  ) <> 2 THEN
    RAISE EXCEPTION 'migration-era producers did not commit clean terminal rows';
  END IF;

  -- An old 0051-aware binary may still claim during overlap. Its all-NULL
  -- liveness tuple remains a visible manual attempt and is never recovered.
  UPDATE letters
  SET entity_extraction_status = 'RUNNING',
      entity_extraction_run_id = post_migration_run,
      entity_extraction_run_revision = entity_extraction_revision + 1
  WHERE id = post_migration_id
    AND entity_extraction_status = 'PENDING'
    AND entity_extraction_run_id IS NULL
    AND entity_extraction_run_revision IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION '0051-aware overlap claim was not accepted after 0053';
  END IF;

  UPDATE letters
  SET entity_extraction_status = 'PENDING',
      entity_extraction_run_id = NULL,
      entity_extraction_run_revision = NULL
  WHERE id = post_migration_id
    AND entity_extraction_status = 'RUNNING'
    AND entity_extraction_run_id = post_migration_run
    AND entity_extraction_run_revision = entity_extraction_revision + 1
    AND entity_extraction_lease_expires_at IS NOT NULL
    AND entity_extraction_lease_run_id = entity_extraction_run_id
    AND entity_extraction_claim_kind = 'QUEUED'
    AND entity_extraction_lease_expires_at <= clock_timestamp();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION '0051-aware overlap claim was recovered automatically';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM letters
    WHERE id = post_migration_id
      AND entity_extraction_status = 'RUNNING'
      AND entity_extraction_run_id = post_migration_run
      AND entity_extraction_run_revision = entity_extraction_revision + 1
      AND entity_extraction_lease_expires_at IS NULL
      AND entity_extraction_lease_run_id IS NULL
      AND entity_extraction_claim_kind IS NULL
  ) THEN
    RAISE EXCEPTION '0051-aware overlap claim did not remain manual';
  END IF;

  -- Exact administrative cancellation remains the deliberate escape hatch.
  UPDATE letters
  SET entity_extraction_status = 'FAILED',
      entity_extraction_run_id = NULL,
      entity_extraction_run_revision = NULL,
      entity_extraction_lease_expires_at = NULL,
      entity_extraction_lease_run_id = NULL,
      entity_extraction_claim_kind = NULL,
      entity_extraction_error = 'Cancelled by rollout test'
  WHERE id = post_migration_id
    AND entity_extraction_status = 'RUNNING'
    AND entity_extraction_run_id = post_migration_run
    AND entity_extraction_run_revision = entity_extraction_revision + 1;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION '0051-aware overlap claim could not be cancelled exactly';
  END IF;
END $$;
