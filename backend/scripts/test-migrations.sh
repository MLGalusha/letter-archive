#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="letter-archive-migration-test-$$"
DB_PORT=5434
DB_NAME="migration_test"
LEGACY_DB_NAME="migration_0051_legacy_test"
LIVENESS_ROLLOUT_DB_NAME="migration_0053_rollout_test"
SOURCE_REVISION_ROLLOUT_DB_NAME="migration_0054_rollout_test"
DB_USER="test"
DB_PASS="test"

cleanup() {
  local exit_code=$?
  echo "Cleaning up..."
  docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT

echo "Starting temporary Postgres container..."
docker run -d \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_DB="$DB_NAME" \
  -e POSTGRES_USER="$DB_USER" \
  -e POSTGRES_PASSWORD="$DB_PASS" \
  -p "$DB_PORT:5432" \
  postgres:16-alpine \
  > /dev/null

echo "Waiting for Postgres to be ready..."
for i in $(seq 1 30); do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; then
    echo "Postgres is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Timed out waiting for Postgres."
    exit 1
  fi
  sleep 1
done

echo "Running migrations..."
DATABASE_URL="postgres://$DB_USER:$DB_PASS@localhost:$DB_PORT/$DB_NAME" \
  npx drizzle-kit migrate

echo "Migrations applied successfully on fresh database."

docker exec -i "$CONTAINER_NAME" \
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
  < "src/db/__tests__/worker-execution-lease.sql" \
  > /dev/null

echo "Worker execution lease semantics regression passed."

docker exec -i "$CONTAINER_NAME" \
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
  < "src/db/__tests__/entity-extraction-liveness.sql" \
  > /dev/null

echo "Entity extraction liveness semantics regression passed."

docker exec -i "$CONTAINER_NAME" \
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
  < "src/db/__tests__/transcript-confirmation-guidance.sql" \
  > /dev/null

echo "Transcript confirmation guidance rollout regression passed."

DATABASE_URL="postgres://$DB_USER:$DB_PASS@localhost:$DB_PORT/$DB_NAME" \
  node scripts/test-page-source-boundary.mjs

recovery_first_setup_count="$(
  docker exec "$CONTAINER_NAME" \
    psql -At -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    -c "WITH prepared AS (
      UPDATE letters
      SET entity_extraction_status = 'RUNNING',
          entity_extraction_run_id = '53000000-0000-4000-8000-000000000011',
          entity_extraction_run_revision = entity_extraction_revision + 1,
          entity_extraction_lease_expires_at =
            clock_timestamp() + interval '8 seconds',
          entity_extraction_lease_run_id =
            '53000000-0000-4000-8000-000000000011',
          entity_extraction_claim_kind = 'QUEUED'
      WHERE id = '53000000-0000-4000-8000-000000000010'
        AND entity_extraction_status = 'PENDING'
      RETURNING 1
    )
    SELECT count(*) FROM prepared;"
)"
if [[ "$recovery_first_setup_count" != "1" ]]; then
  echo "Could not prepare the recovery-first entity race."
  exit 1
fi

# Force the recovery-side lock ordering immediately before expiry. The
# publisher starts while the previously committed lease is still live, blocks
# on this row lock, and must lose compare-and-set re-evaluation after recovery.
docker exec -i "$CONTAINER_NAME" \
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
  > /dev/null <<'SQL' &
BEGIN;
SET LOCAL application_name = 'entity-recovery-lock-first';
SELECT id
FROM letters
WHERE id = '53000000-0000-4000-8000-000000000010'
FOR UPDATE;
SELECT pg_sleep(10);
UPDATE letters
SET entity_extraction_status = 'PENDING',
    entity_extraction_run_id = NULL,
    entity_extraction_run_revision = NULL,
    entity_extraction_lease_expires_at = NULL,
    entity_extraction_lease_run_id = NULL,
    entity_extraction_claim_kind = NULL
WHERE id = '53000000-0000-4000-8000-000000000010'
  AND entity_extraction_status = 'RUNNING'
  AND entity_extraction_run_id =
    '53000000-0000-4000-8000-000000000011'
  AND entity_extraction_run_revision = entity_extraction_revision + 1
  AND entity_extraction_lease_run_id = entity_extraction_run_id
  AND entity_extraction_claim_kind = 'QUEUED'
  AND entity_extraction_lease_expires_at <= clock_timestamp();
COMMIT;
SQL
entity_recovery_owner_pid=$!

entity_recovery_locked=false
for _ in $(seq 1 30); do
  if [[ "$(
    docker exec "$CONTAINER_NAME" \
      psql -At -U "$DB_USER" -d "$DB_NAME" \
      -c "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'entity-recovery-lock-first' AND query LIKE 'SELECT pg_sleep%';"
  )" == "1" ]]; then
    entity_recovery_locked=true
    break
  fi
  sleep 0.1
done

if [[ "$entity_recovery_locked" != "true" ]]; then
  echo "Timed out waiting for the recovery-first entity row lock."
  wait "$entity_recovery_owner_pid" || true
  exit 1
fi

recovery_first_lease_live="$(
  docker exec "$CONTAINER_NAME" \
    psql -At -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT entity_extraction_lease_expires_at > clock_timestamp()
        FROM letters
        WHERE id = '53000000-0000-4000-8000-000000000010';"
)"
if [[ "$recovery_first_lease_live" != "t" ]]; then
  echo "The publisher did not enter the recovery-first race with a live lease."
  wait "$entity_recovery_owner_pid" || true
  exit 1
fi
recovery_first_owner_still_locked="$(
  docker exec "$CONTAINER_NAME" \
    psql -At -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'entity-recovery-lock-first' AND query LIKE 'SELECT pg_sleep%';"
)"
if [[ "$recovery_first_owner_still_locked" != "1" ]]; then
  echo "The recovery-first row lock ended before the publisher contended."
  wait "$entity_recovery_owner_pid" || true
  exit 1
fi

recovery_first_publication_count="$(
  docker exec "$CONTAINER_NAME" \
    psql -At -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    -c "WITH published AS (
      UPDATE letters
      SET entity_extraction_status = 'SUCCESS',
          entity_extraction_json = '{\"people\":[],\"places\":[]}'::jsonb,
          entity_extraction_revision = entity_extraction_run_revision,
          entity_extraction_run_id = NULL,
          entity_extraction_run_revision = NULL,
          entity_extraction_lease_expires_at = NULL,
          entity_extraction_lease_run_id = NULL,
          entity_extraction_claim_kind = NULL
      WHERE id = '53000000-0000-4000-8000-000000000010'
        AND entity_extraction_status = 'RUNNING'
        AND entity_extraction_run_id =
          '53000000-0000-4000-8000-000000000011'
        AND entity_extraction_run_revision = entity_extraction_revision + 1
        AND entity_extraction_lease_run_id = entity_extraction_run_id
        AND entity_extraction_claim_kind IS NOT NULL
        AND entity_extraction_lease_expires_at > clock_timestamp()
      RETURNING 1
    )
    SELECT count(*) FROM published;"
)"
wait "$entity_recovery_owner_pid"

if [[ "$recovery_first_publication_count" != "0" ]]; then
  echo "A blocked entity publisher committed after recovery won the row lock."
  exit 1
fi

recovery_first_final_count="$(
  docker exec "$CONTAINER_NAME" \
    psql -At -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT count(*)
        FROM letters
        WHERE id = '53000000-0000-4000-8000-000000000010'
          AND entity_extraction_status = 'PENDING'
          AND entity_extraction_run_id IS NULL
          AND entity_extraction_run_revision IS NULL
          AND entity_extraction_lease_expires_at IS NULL
          AND entity_extraction_lease_run_id IS NULL
          AND entity_extraction_claim_kind IS NULL
          AND entity_extraction_revision = 0;"
)"
if [[ "$recovery_first_final_count" != "1" ]]; then
  echo "Recovery-first entity race did not leave the exact queued state."
  exit 1
fi

echo "Entity extraction recovery-first publication race passed."

publication_first_setup_count="$(
  docker exec "$CONTAINER_NAME" \
    psql -At -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    -c "WITH prepared AS (
      UPDATE letters
      SET entity_extraction_status = 'RUNNING',
          entity_extraction_run_id = '53000000-0000-4000-8000-000000000021',
          entity_extraction_run_revision = entity_extraction_revision + 1,
          entity_extraction_lease_expires_at =
            clock_timestamp() + interval '6 seconds',
          entity_extraction_lease_run_id =
            '53000000-0000-4000-8000-000000000021',
          entity_extraction_claim_kind = 'QUEUED'
      WHERE id = '53000000-0000-4000-8000-000000000020'
        AND entity_extraction_status = 'PENDING'
      RETURNING 1
    )
    SELECT count(*) FROM prepared;"
)"
if [[ "$publication_first_setup_count" != "1" ]]; then
  echo "Could not prepare the publication-first entity race."
  exit 1
fi

# The publisher refreshes the lease and holds the row through materialization.
# Recovery starts only after the old committed deadline has expired, blocks,
# and must re-evaluate to zero after the successful publication commits.
docker exec -i "$CONTAINER_NAME" \
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
  > /dev/null <<'SQL' &
BEGIN;
SET LOCAL application_name = 'entity-publication-lock-first';
UPDATE letters
SET entity_extraction_lease_expires_at =
      clock_timestamp() + interval '5 minutes'
WHERE id = '53000000-0000-4000-8000-000000000020'
  AND entity_extraction_status = 'RUNNING'
  AND entity_extraction_run_id =
    '53000000-0000-4000-8000-000000000021'
  AND entity_extraction_run_revision = entity_extraction_revision + 1
  AND entity_extraction_lease_run_id = entity_extraction_run_id
  AND entity_extraction_claim_kind IS NOT NULL
  AND entity_extraction_lease_expires_at > clock_timestamp();
SELECT pg_sleep(12);
UPDATE letters
SET entity_extraction_status = 'SUCCESS',
    entity_extraction_json = '{"people":[],"places":[]}'::jsonb,
    entity_extraction_revision = entity_extraction_run_revision,
    entity_extraction_run_id = NULL,
    entity_extraction_run_revision = NULL,
    entity_extraction_lease_expires_at = NULL,
    entity_extraction_lease_run_id = NULL,
    entity_extraction_claim_kind = NULL
WHERE id = '53000000-0000-4000-8000-000000000020'
  AND entity_extraction_status = 'RUNNING'
  AND entity_extraction_run_id =
    '53000000-0000-4000-8000-000000000021'
  AND entity_extraction_run_revision = entity_extraction_revision + 1
  AND entity_extraction_lease_run_id = entity_extraction_run_id
  AND entity_extraction_claim_kind IS NOT NULL
  AND entity_extraction_lease_expires_at > clock_timestamp();
COMMIT;
SQL
entity_publication_owner_pid=$!

entity_publication_locked=false
for _ in $(seq 1 30); do
  if [[ "$(
    docker exec "$CONTAINER_NAME" \
      psql -At -U "$DB_USER" -d "$DB_NAME" \
      -c "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'entity-publication-lock-first' AND query LIKE 'SELECT pg_sleep%';"
  )" == "1" ]]; then
    entity_publication_locked=true
    break
  fi
  sleep 0.1
done

if [[ "$entity_publication_locked" != "true" ]]; then
  echo "Timed out waiting for the publication-first entity row lock."
  wait "$entity_publication_owner_pid" || true
  exit 1
fi

sleep 7
publication_first_old_lease_expired="$(
  docker exec "$CONTAINER_NAME" \
    psql -At -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT entity_extraction_lease_expires_at <= clock_timestamp()
        FROM letters
        WHERE id = '53000000-0000-4000-8000-000000000020';"
)"
if [[ "$publication_first_old_lease_expired" != "t" ]]; then
  echo "Recovery entered the publication-first race before the old lease expired."
  wait "$entity_publication_owner_pid" || true
  exit 1
fi
publication_first_owner_still_locked="$(
  docker exec "$CONTAINER_NAME" \
    psql -At -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'entity-publication-lock-first' AND query LIKE 'SELECT pg_sleep%';"
)"
if [[ "$publication_first_owner_still_locked" != "1" ]]; then
  echo "The publication-first row lock ended before recovery contended."
  wait "$entity_publication_owner_pid" || true
  exit 1
fi

publication_first_recovery_count="$(
  docker exec "$CONTAINER_NAME" \
    psql -At -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    -c "WITH recovered AS (
      UPDATE letters
      SET entity_extraction_status = 'PENDING',
          entity_extraction_run_id = NULL,
          entity_extraction_run_revision = NULL,
          entity_extraction_lease_expires_at = NULL,
          entity_extraction_lease_run_id = NULL,
          entity_extraction_claim_kind = NULL
      WHERE id = '53000000-0000-4000-8000-000000000020'
        AND entity_extraction_status = 'RUNNING'
        AND entity_extraction_run_id =
          '53000000-0000-4000-8000-000000000021'
        AND entity_extraction_run_revision = entity_extraction_revision + 1
        AND entity_extraction_lease_run_id = entity_extraction_run_id
        AND entity_extraction_claim_kind = 'QUEUED'
        AND entity_extraction_lease_expires_at <= clock_timestamp()
      RETURNING 1
    )
    SELECT count(*) FROM recovered;"
)"
wait "$entity_publication_owner_pid"

if [[ "$publication_first_recovery_count" != "0" ]]; then
  echo "Blocked entity recovery revoked an already-published attempt."
  exit 1
fi

publication_first_final_count="$(
  docker exec "$CONTAINER_NAME" \
    psql -At -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT count(*)
        FROM letters
        WHERE id = '53000000-0000-4000-8000-000000000020'
          AND entity_extraction_status = 'SUCCESS'
          AND entity_extraction_revision = 1
          AND entity_extraction_run_id IS NULL
          AND entity_extraction_run_revision IS NULL
          AND entity_extraction_lease_expires_at IS NULL
          AND entity_extraction_lease_run_id IS NULL
          AND entity_extraction_claim_kind IS NULL
          AND entity_extraction_json =
            '{\"people\":[],\"places\":[]}'::jsonb;"
)"
if [[ "$publication_first_final_count" != "1" ]]; then
  echo "Publication-first entity race did not commit the exact projection."
  exit 1
fi

echo "Entity extraction publication-first recovery race passed."

docker exec -i "$CONTAINER_NAME" \
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
  > /dev/null <<'SQL' &
BEGIN;
SET LOCAL application_name = 'worker-lease-owner-a';
UPDATE worker_state
SET execution_token = '30000000-0000-4000-8000-000000000003',
    execution_lease_expires_at = clock_timestamp() + interval '2 minutes',
    is_polling = true
WHERE id = 'singleton'
  AND (
    execution_token IS NULL
    OR execution_lease_expires_at <= clock_timestamp()
  );
SELECT pg_sleep(3);
COMMIT;
SQL
lease_owner_pid=$!

owner_locked=false
for _ in $(seq 1 30); do
  if [[ "$(
    docker exec "$CONTAINER_NAME" \
      psql -At -U "$DB_USER" -d "$DB_NAME" \
      -c "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'worker-lease-owner-a' AND query LIKE 'SELECT pg_sleep%';"
  )" == "1" ]]; then
    owner_locked=true
    break
  fi
  sleep 0.1
done

if [[ "$owner_locked" != "true" ]]; then
  echo "Timed out waiting for the first worker acquisition lock."
  wait "$lease_owner_pid" || true
  exit 1
fi

contender_count="$(
  docker exec "$CONTAINER_NAME" \
    psql -At -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    -c "WITH claimed AS (
      UPDATE worker_state
      SET execution_token = '40000000-0000-4000-8000-000000000004',
          execution_lease_expires_at = clock_timestamp() + interval '2 minutes'
      WHERE id = 'singleton'
        AND (
          execution_token IS NULL
          OR execution_lease_expires_at <= clock_timestamp()
        )
      RETURNING 1
    )
    SELECT count(*) FROM claimed;"
)"
wait "$lease_owner_pid"

if [[ "$contender_count" != "0" ]]; then
  echo "A blocked worker contender acquired the already-owned singleton."
  exit 1
fi

docker exec "$CONTAINER_NAME" \
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
  -c "UPDATE worker_state
      SET execution_token = NULL,
          execution_lease_expires_at = NULL,
          is_polling = false
      WHERE id = 'singleton'
        AND execution_token = '30000000-0000-4000-8000-000000000003';" \
  > /dev/null

echo "Worker execution lease blocked-contender regression passed."

echo "Replaying migration 0051 over legacy entity state..."
docker exec "$CONTAINER_NAME" createdb -U "$DB_USER" "$LEGACY_DB_NAME"

while IFS= read -r migration_tag; do
  docker exec -i "$CONTAINER_NAME" \
    psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$LEGACY_DB_NAME" \
    < "src/db/migrations/${migration_tag}.sql" \
    > /dev/null
done < <(
  node --input-type=module -e "
    import fs from 'node:fs';
    const journal = JSON.parse(
      fs.readFileSync('src/db/migrations/meta/_journal.json', 'utf8'),
    );
    for (const entry of journal.entries.filter((candidate) => candidate.idx < 51)) {
      console.log(entry.tag);
    }
  "
)

docker exec -i "$CONTAINER_NAME" \
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$LEGACY_DB_NAME" \
  > /dev/null <<'SQL'
INSERT INTO collections (id, collection_code)
VALUES ('00000000-0000-0000-0000-000000000001', 'AUD');

INSERT INTO canonical_persons (id, canonical_name) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Legacy Partial'),
  ('10000000-0000-0000-0000-000000000002', 'Current Result');

INSERT INTO letters (
  id,
  collection_id,
  date_raw,
  type,
  type_sequence,
  metadata_status,
  entity_extraction_status,
  entity_extraction_json
) VALUES
  (
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '19000101',
    'L',
    1,
    'SUCCESS',
    'RUNNING',
    NULL
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '19000102',
    'L',
    1,
    'SUCCESS',
    'SUCCESS',
    '"malformed-scalar"'::jsonb
  );

INSERT INTO letter_persons (
  id,
  letter_id,
  person_id,
  role,
  name_as_written
) VALUES (
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  'sender',
  'Legacy Partial'
);
SQL

docker exec -i "$CONTAINER_NAME" \
  psql --single-transaction -v ON_ERROR_STOP=1 \
  -U "$DB_USER" -d "$LEGACY_DB_NAME" \
  < "src/db/migrations/0051_add_entity_extraction_commit_boundary.sql" \
  > /dev/null

docker exec -i "$CONTAINER_NAME" \
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$LEGACY_DB_NAME" \
  > /dev/null <<'SQL'
-- The migration is the drain boundary: an old binary cannot start another
-- tokenless attempt after it commits.
UPDATE letters
SET entity_extraction_status = 'PENDING'
WHERE id = '30000000-0000-0000-0000-000000000002';

DO $$
DECLARE
  observed_constraint text;
BEGIN
  BEGIN
    UPDATE letters
    SET entity_extraction_status = 'RUNNING', updated_at = now()
    WHERE id = '30000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'tokenless RUNNING transition unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS observed_constraint = CONSTRAINT_NAME;
    IF observed_constraint <> 'entity_extraction_running_requires_owner' THEN
      RAISE;
    END IF;
  END;
END $$;

-- A draining old binary omits the new provenance column. The database stamps
-- its uncommitted candidate revision.
INSERT INTO letter_persons (
  id,
  letter_id,
  person_id,
  role,
  name_as_written
) VALUES (
  '40000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'sender',
  'Legacy Partial'
);

DO $$
BEGIN
  IF (
    SELECT entity_extraction_revision
    FROM letter_persons
    WHERE id = '40000000-0000-0000-0000-000000000002'
  ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'legacy output was not stamped with pending revision 1';
  END IF;
END $$;

-- The process disappears before SUCCESS. Explicit cancellation must discard
-- only the abandoned candidate so a current retry can safely reuse revision 1.
UPDATE letters
SET entity_extraction_status = 'FAILED',
    entity_extraction_error = 'Cancelled by admin',
    updated_at = now()
WHERE id = '30000000-0000-0000-0000-000000000001'
  AND entity_extraction_status = 'RUNNING'
  AND entity_extraction_run_id IS NULL
  AND entity_extraction_run_revision IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM letter_persons
    WHERE id = '40000000-0000-0000-0000-000000000002'
  ) THEN
    RAISE EXCEPTION 'abandoned legacy output survived cancellation';
  END IF;
END $$;

UPDATE letters
SET entity_extraction_status = 'PENDING',
    entity_extraction_error = NULL,
    updated_at = now()
WHERE id = '30000000-0000-0000-0000-000000000001';

UPDATE letters
SET entity_extraction_status = 'RUNNING',
    entity_extraction_run_id = '80000000-0000-0000-0000-000000000001',
    entity_extraction_run_revision = entity_extraction_revision + 1,
    updated_at = now()
WHERE id = '30000000-0000-0000-0000-000000000001';

-- A terminal update from an old binary leaves the new owner fields untouched;
-- the database must reject it instead of stealing the current run.
DO $$
DECLARE
  observed_constraint text;
BEGIN
  BEGIN
    UPDATE letters
    SET entity_extraction_status = 'SUCCESS',
        entity_extraction_json = '{"people":[]}'::jsonb,
        updated_at = now()
    WHERE id = '30000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'old terminal writer unexpectedly overwrote current owner';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS observed_constraint = CONSTRAINT_NAME;
    IF observed_constraint <> 'entity_extraction_terminal_requires_owner_reconciliation' THEN
      RAISE;
    END IF;
  END;
END $$;

INSERT INTO letter_persons (
  id,
  letter_id,
  person_id,
  role,
  name_as_written,
  entity_extraction_revision
) VALUES (
  '40000000-0000-0000-0000-000000000003',
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  'recipient',
  'Current Result',
  1
);

UPDATE letters
SET entity_extraction_status = 'SUCCESS',
    entity_extraction_json = '{"people":[{"name":"Current Result","role":"recipient"}]}'::jsonb,
    entity_extraction_revision = 1,
    entity_extraction_run_id = NULL,
    entity_extraction_run_revision = NULL,
    entity_extraction_error = NULL,
    updated_at = now()
WHERE id = '30000000-0000-0000-0000-000000000001';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM letter_persons
    WHERE letter_id = '30000000-0000-0000-0000-000000000001'
      AND person_id = '10000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'current retry inherited abandoned legacy output';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM letters
    WHERE id = '30000000-0000-0000-0000-000000000001'
      AND entity_extraction_status = 'SUCCESS'
      AND entity_extraction_revision = 1
  ) THEN
    RAISE EXCEPTION 'current retry did not commit revision 1';
  END IF;
END $$;
SQL

echo "Migration 0051 legacy cancellation/retry regression passed."

echo "Replaying migration 0053 over active migration-era entity attempts..."
docker exec "$CONTAINER_NAME" \
  createdb -U "$DB_USER" "$LIVENESS_ROLLOUT_DB_NAME"

while IFS= read -r migration_tag; do
  docker exec -i "$CONTAINER_NAME" \
    psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$LIVENESS_ROLLOUT_DB_NAME" \
    < "src/db/migrations/${migration_tag}.sql" \
    > /dev/null
done < <(
  node --input-type=module -e "
    import fs from 'node:fs';
    const journal = JSON.parse(
      fs.readFileSync('src/db/migrations/meta/_journal.json', 'utf8'),
    );
    for (const entry of journal.entries.filter((candidate) => candidate.idx < 51)) {
      console.log(entry.tag);
    }
  "
)

# Seed the two shapes that may already be active when the rollout reaches
# migration 0051: one tokenless producer and one row that a 0051-aware old
# binary will claim before 0053 lands.
docker exec -i "$CONTAINER_NAME" \
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$LIVENESS_ROLLOUT_DB_NAME" \
  > /dev/null <<'SQL'
INSERT INTO collections (id, collection_code)
VALUES ('00000000-0000-0000-0000-000000000054', 'R53');

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
    '53000000-0000-4000-8000-000000000100',
    '00000000-0000-0000-0000-000000000054',
    '19000201',
    'L',
    1,
    'SUCCESS',
    'SUCCESS',
    'RUNNING'
  ),
  (
    '53000000-0000-4000-8000-000000000101',
    '00000000-0000-0000-0000-000000000054',
    '19000202',
    'L',
    1,
    'SUCCESS',
    'SUCCESS',
    'PENDING'
  ),
  (
    '53000000-0000-4000-8000-000000000103',
    '00000000-0000-0000-0000-000000000054',
    '19000203',
    'L',
    1,
    'SUCCESS',
    'SUCCESS',
    'PENDING'
  );
SQL

for migration_tag in \
  "0051_add_entity_extraction_commit_boundary" \
  "0052_add_worker_execution_lease"; do
  docker exec -i "$CONTAINER_NAME" \
    psql --single-transaction -v ON_ERROR_STOP=1 \
    -U "$DB_USER" -d "$LIVENESS_ROLLOUT_DB_NAME" \
    < "src/db/migrations/${migration_tag}.sql" \
    > /dev/null
done

owned_rollout_claim_count="$(
  docker exec "$CONTAINER_NAME" \
    psql -At -v ON_ERROR_STOP=1 \
    -U "$DB_USER" -d "$LIVENESS_ROLLOUT_DB_NAME" \
    -c "WITH claimed AS (
      UPDATE letters
      SET entity_extraction_status = 'RUNNING',
          entity_extraction_run_id =
            '53000000-0000-4000-8000-000000000102',
          entity_extraction_run_revision = entity_extraction_revision + 1
      WHERE id = '53000000-0000-4000-8000-000000000101'
        AND entity_extraction_status = 'PENDING'
      RETURNING 1
    )
    SELECT count(*) FROM claimed;"
)"
if [[ "$owned_rollout_claim_count" != "1" ]]; then
  echo "Could not seed the 0051-owned pre-liveness entity attempt."
  exit 1
fi

docker exec -i "$CONTAINER_NAME" \
  psql --single-transaction -v ON_ERROR_STOP=1 \
  -U "$DB_USER" -d "$LIVENESS_ROLLOUT_DB_NAME" \
  < "src/db/migrations/0053_add_entity_extraction_liveness.sql" \
  > /dev/null

docker exec -i "$CONTAINER_NAME" \
  psql -v ON_ERROR_STOP=1 \
  -U "$DB_USER" -d "$LIVENESS_ROLLOUT_DB_NAME" \
  < "src/db/__tests__/entity-extraction-liveness-rollout.sql" \
  > /dev/null

echo "Migration 0053 active-attempt rollout regression passed."

echo "Replaying migration 0054 over an existing correspondence..."
docker exec "$CONTAINER_NAME" \
  createdb -U "$DB_USER" "$SOURCE_REVISION_ROLLOUT_DB_NAME"

while IFS= read -r migration_tag; do
  docker exec -i "$CONTAINER_NAME" \
    psql -v ON_ERROR_STOP=1 -U "$DB_USER" \
    -d "$SOURCE_REVISION_ROLLOUT_DB_NAME" \
    < "src/db/migrations/${migration_tag}.sql" \
    > /dev/null
done < <(
  node --input-type=module -e "
    import fs from 'node:fs';
    const journal = JSON.parse(
      fs.readFileSync('src/db/migrations/meta/_journal.json', 'utf8'),
    );
    for (const entry of journal.entries.filter((candidate) => candidate.idx < 54)) {
      console.log(entry.tag);
    }
  "
)

docker exec -i "$CONTAINER_NAME" \
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" \
  -d "$SOURCE_REVISION_ROLLOUT_DB_NAME" \
  > /dev/null <<'SQL'
INSERT INTO collections (id, collection_code, profile_status)
VALUES (
  '54000000-0000-4000-8000-000000000010',
  'R54',
  'VERIFIED'
);

INSERT INTO letters (
  id,
  collection_id,
  date_raw,
  type,
  type_sequence,
  visibility
) VALUES (
  '54000000-0000-4000-8000-000000000011',
  '54000000-0000-4000-8000-000000000010',
  '19470810',
  'L',
  1,
  'PUBLISHED'
);

INSERT INTO letter_versions (
  letter_id,
  field_type,
  version_number,
  content,
  source
) VALUES (
  '54000000-0000-4000-8000-000000000011',
  'transcript',
  1,
  '{"text":"legacy source transcript"}'::jsonb,
  'human'
);
SQL

docker exec -i "$CONTAINER_NAME" \
  psql --single-transaction -v ON_ERROR_STOP=1 \
  -U "$DB_USER" -d "$SOURCE_REVISION_ROLLOUT_DB_NAME" \
  < "src/db/migrations/0054_add_page_source_revisions.sql" \
  > /dev/null

source_revision_upgrade_count="$(
  docker exec "$CONTAINER_NAME" \
    psql -At -v ON_ERROR_STOP=1 -U "$DB_USER" \
    -d "$SOURCE_REVISION_ROLLOUT_DB_NAME" \
    -c "SELECT count(*)
        FROM collections c
        JOIN letters l ON l.collection_id = c.id
        JOIN letter_versions v ON v.letter_id = l.id
        WHERE c.id = '54000000-0000-4000-8000-000000000010'
          AND c.profile_revision = 0
          AND c.profile_source_fingerprint IS NULL
          AND l.primary_source_revision = 0
          AND v.primary_source_revision = 0;"
)"
if [[ "$source_revision_upgrade_count" != "1" ]]; then
  echo "Migration 0054 did not initialize source epochs while leaving legacy profile provenance unbound."
  exit 1
fi

DATABASE_URL="postgres://$DB_USER:$DB_PASS@localhost:$DB_PORT/$SOURCE_REVISION_ROLLOUT_DB_NAME" \
  node scripts/test-page-source-boundary.mjs

echo "Migration 0054 upgraded correspondence regression passed."
