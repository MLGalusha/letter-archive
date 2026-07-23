#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="letter-archive-migration-test-$$"
DB_PORT=5434
DB_NAME="migration_test"
LEGACY_DB_NAME="migration_0051_legacy_test"
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
