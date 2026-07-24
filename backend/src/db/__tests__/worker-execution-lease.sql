DO $$
DECLARE
  affected integer;
  active boolean;
  owner_a uuid := '10000000-0000-4000-8000-000000000001';
  owner_b uuid := '20000000-0000-4000-8000-000000000002';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM worker_state
    WHERE id = 'singleton'
      AND execution_token IS NULL
      AND execution_lease_expires_at IS NULL
  ) THEN
    RAISE EXCEPTION 'worker singleton was not initialized as unowned';
  END IF;

  BEGIN
    UPDATE worker_state
    SET execution_token = owner_a
    WHERE id = 'singleton';
    RAISE EXCEPTION 'partial worker ownership tuple unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  UPDATE worker_state
  SET execution_token = owner_a,
      execution_lease_expires_at = clock_timestamp() + interval '2 minutes',
      is_polling = true
  WHERE id = 'singleton'
    AND (
      execution_token IS NULL
      OR execution_lease_expires_at <= clock_timestamp()
    );
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'first worker did not acquire the singleton';
  END IF;

  UPDATE worker_state
  SET execution_token = owner_b,
      execution_lease_expires_at = clock_timestamp() + interval '2 minutes'
  WHERE id = 'singleton'
    AND (
      execution_token IS NULL
      OR execution_lease_expires_at <= clock_timestamp()
    );
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'second worker acquired a live singleton lease';
  END IF;

  SELECT is_polling
      AND execution_token IS NOT NULL
      AND execution_lease_expires_at > clock_timestamp()
  INTO active
  FROM worker_state
  WHERE id = 'singleton';
  IF active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'live execution was not reported active';
  END IF;

  UPDATE worker_state
  SET last_error = 'owner-a-report',
      execution_lease_expires_at = clock_timestamp() + interval '2 minutes'
  WHERE id = 'singleton'
    AND execution_token = owner_a
    AND execution_lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'live owner could not renew and publish';
  END IF;

  UPDATE worker_state
  SET last_error = 'stale-owner-report'
  WHERE id = 'singleton'
    AND execution_token = owner_b
    AND execution_lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'non-owner published worker state';
  END IF;

  UPDATE worker_state
  SET execution_lease_expires_at = clock_timestamp() - interval '1 second'
  WHERE id = 'singleton'
    AND execution_token = owner_a;

  SELECT is_polling
      AND execution_token IS NOT NULL
      AND execution_lease_expires_at > clock_timestamp()
  INTO active
  FROM worker_state
  WHERE id = 'singleton';
  IF active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'expired execution was still reported active';
  END IF;

  UPDATE worker_state
  SET execution_token = owner_b,
      execution_lease_expires_at = clock_timestamp() + interval '2 minutes',
      last_error = NULL,
      is_polling = true
  WHERE id = 'singleton'
    AND (
      execution_token IS NULL
      OR execution_lease_expires_at <= clock_timestamp()
    );
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'successor did not take over an expired lease';
  END IF;

  UPDATE worker_state
  SET execution_token = NULL,
      execution_lease_expires_at = NULL,
      is_polling = false,
      last_error = 'stale-release'
  WHERE id = 'singleton'
    AND execution_token = owner_a;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'stale owner released its successor';
  END IF;

  UPDATE worker_state
  SET execution_lease_expires_at = clock_timestamp() - interval '1 second'
  WHERE id = 'singleton'
    AND execution_token = owner_b;

  UPDATE worker_state
  SET execution_token = NULL,
      execution_lease_expires_at = NULL,
      is_polling = false
  WHERE id = 'singleton'
    AND execution_token = owner_b;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'exact owner could not release after lease expiry';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM worker_state
    WHERE id = 'singleton'
      AND execution_token IS NULL
      AND execution_lease_expires_at IS NULL
      AND is_polling = false
      AND last_error IS NULL
  ) THEN
    RAISE EXCEPTION 'worker singleton did not finish in a clean idle state';
  END IF;
END $$;
