#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="letter-archive-migration-test-$$"
DB_PORT=5434
DB_NAME="migration_test"
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
