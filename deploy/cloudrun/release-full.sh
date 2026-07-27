#!/usr/bin/env bash

set -euo pipefail

required_variables=(
  LETTER_ARCHIVE_PROJECT_ID
  LETTER_ARCHIVE_REGION
  LETTER_ARCHIVE_RELEASE_SHA
  LETTER_ARCHIVE_BUILD_ID
  LETTER_ARCHIVE_BACKEND_SERVICE_ACCOUNT
  LETTER_ARCHIVE_FRONTEND_SERVICE_ACCOUNT
  LETTER_ARCHIVE_WORKER_SERVICE_ACCOUNT
  LETTER_ARCHIVE_BACKEND_IMAGE_REPOSITORY
  LETTER_ARCHIVE_FRONTEND_IMAGE_REPOSITORY
  LETTER_ARCHIVE_BACKEND_PRODUCTION_URL
  LETTER_ARCHIVE_FRONTEND_PRODUCTION_URL
)
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Missing full release value: $variable_name" >&2
    exit 1
  fi
done

worker_job=letter-archive-worker
backfill_job=letter-archive-backfill-dimensions
state_directory="rendered/release-state"
if [[ -e "$state_directory" ]]; then
  echo "Release state directory already exists" >&2
  exit 1
fi
mkdir -p "$state_directory"

snapshot_job() {
  local job_name="$1"
  local output_path="$2"
  gcloud run jobs describe "$job_name" \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --region="$LETTER_ARCHIVE_REGION" \
    --format=export > "$output_path"
}

job_image() {
  local job_name="$1"
  gcloud run jobs describe "$job_name" \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --region="$LETTER_ARCHIVE_REGION" \
    --format='value(spec.template.spec.template.spec.containers[0].image)'
}

snapshot_job "$worker_job" "$state_directory/worker.yaml"
snapshot_job "$backfill_job" "$state_directory/backfill.yaml"
previous_worker_image="$(job_image "$worker_job")"
previous_backfill_image="$(job_image "$backfill_job")"
if [[ -z "$previous_worker_image" || -z "$previous_backfill_image" ]]; then
  echo "Could not snapshot the previous job images" >&2
  exit 1
fi
gcloud run jobs get-iam-policy "$worker_job" \
  --project="$LETTER_ARCHIVE_PROJECT_ID" \
  --region="$LETTER_ARCHIVE_REGION" \
  --format=json > "$state_directory/worker-policy.json"

scheduler_exists=false
scheduler_was_enabled=false
if gcloud services list \
  --project="$LETTER_ARCHIVE_PROJECT_ID" \
  --enabled \
  --filter='config.name=cloudscheduler.googleapis.com' \
  --format='value(config.name)' \
  | grep -qx 'cloudscheduler.googleapis.com'; then
  if scheduler_state="$(
    gcloud scheduler jobs describe letter-archive-worker-reconcile \
      --project="$LETTER_ARCHIVE_PROJECT_ID" \
      --location="$LETTER_ARCHIVE_REGION" \
      --format='value(state)' 2>/dev/null
  )"; then
    scheduler_exists=true
    if [[ "$scheduler_state" == ENABLED ]]; then
      scheduler_was_enabled=true
    fi
  fi
fi

rollback_jobs=false
backend_committed=false

resume_scheduler() {
  if [[ "$scheduler_was_enabled" != true ]]; then
    return 0
  fi
  for attempt in $(seq 1 10); do
    gcloud scheduler jobs resume letter-archive-worker-reconcile \
      --project="$LETTER_ARCHIVE_PROJECT_ID" \
      --location="$LETTER_ARCHIVE_REGION" \
      --quiet || true
    scheduler_state="$(
      gcloud scheduler jobs describe letter-archive-worker-reconcile \
        --project="$LETTER_ARCHIVE_PROJECT_ID" \
        --location="$LETTER_ARCHIVE_REGION" \
        --format='value(state)' 2>/dev/null || true
    )"
    if [[ "$scheduler_state" == ENABLED ]]; then
      return 0
    fi
    sleep 3
  done
  return 1
}

restore_release_jobs() {
  local exit_code="$?"
  trap - EXIT
  if [[ "$exit_code" -eq 0 || "$rollback_jobs" != true ]]; then
    exit "$exit_code"
  fi

  if [[ "$backend_committed" == true ]]; then
    if ! resume_scheduler; then
      echo "CRITICAL: new backend is live but Scheduler could not be resumed" >&2
      exit 73
    fi
    exit "$exit_code"
  fi

  echo "Restoring pre-release worker and backfill job definitions" >&2
  restore_complete=true
  gcloud run jobs replace "$state_directory/worker.yaml" \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --region="$LETTER_ARCHIVE_REGION" \
    --quiet || restore_complete=false
  gcloud run jobs replace "$state_directory/backfill.yaml" \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --region="$LETTER_ARCHIVE_REGION" \
    --quiet || restore_complete=false
  gcloud run jobs set-iam-policy "$worker_job" \
    "$state_directory/worker-policy.json" \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --region="$LETTER_ARCHIVE_REGION" \
    --quiet || restore_complete=false

  if [[ "$(job_image "$worker_job" 2>/dev/null || true)" \
    != "$previous_worker_image" ]]; then
    restore_complete=false
  fi
  if [[ "$(job_image "$backfill_job" 2>/dev/null || true)" \
    != "$previous_backfill_image" ]]; then
    restore_complete=false
  fi
  if [[ "$scheduler_was_enabled" == true ]]; then
    resume_scheduler || restore_complete=false
  fi

  if [[ "$restore_complete" != true ]]; then
    echo "CRITICAL: failed to restore the pre-release background jobs" >&2
    exit 72
  fi
  exit "$exit_code"
}
trap restore_release_jobs EXIT

gcloud run jobs replace rendered/cloudrun/backend-migrate-job.yaml \
  --project="$LETTER_ARCHIVE_PROJECT_ID" \
  --region="$LETTER_ARCHIVE_REGION" \
  --quiet
gcloud run jobs execute letter-archive-migrate \
  --project="$LETTER_ARCHIVE_PROJECT_ID" \
  --region="$LETTER_ARCHIVE_REGION" \
  --args=dist/cli/migrate.js \
  --wait

rollback_jobs=true
if [[ "$scheduler_was_enabled" == true ]]; then
  gcloud scheduler jobs pause letter-archive-worker-reconcile \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --location="$LETTER_ARCHIVE_REGION" \
    --quiet
fi

for service_account in \
  "$LETTER_ARCHIVE_BACKEND_SERVICE_ACCOUNT" \
  "$LETTER_ARCHIVE_WORKER_SERVICE_ACCOUNT"; do
  gcloud run jobs remove-iam-policy-binding "$worker_job" \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --region="$LETTER_ARCHIVE_REGION" \
    --member="serviceAccount:${service_account}" \
    --role=roles/run.invoker \
    --quiet || true
done

gcloud run jobs get-iam-policy "$worker_job" \
  --project="$LETTER_ARCHIVE_PROJECT_ID" \
  --region="$LETTER_ARCHIVE_REGION" \
  --format=json \
  | LETTER_ARCHIVE_BACKEND_MEMBER="serviceAccount:${LETTER_ARCHIVE_BACKEND_SERVICE_ACCOUNT}" \
    LETTER_ARCHIVE_WORKER_MEMBER="serviceAccount:${LETTER_ARCHIVE_WORKER_SERVICE_ACCOUNT}" \
    python3 -c '
import json
import os
import sys
policy = json.load(sys.stdin)
for binding in policy.get("bindings", []):
    if binding.get("role") != "roles/run.invoker":
        continue
    members = set(binding.get("members", []))
    if os.environ["LETTER_ARCHIVE_BACKEND_MEMBER"] in members:
        raise SystemExit("backend can still invoke the worker during cutover")
    if os.environ["LETTER_ARCHIVE_WORKER_MEMBER"] in members:
        raise SystemExit("worker can still hand off during cutover")
'

gcloud run jobs replace rendered/cloudrun/backend-backfill-dimensions-job.yaml \
  --project="$LETTER_ARCHIVE_PROJECT_ID" \
  --region="$LETTER_ARCHIVE_REGION" \
  --quiet
gcloud run jobs replace rendered/cloudrun/backend-worker-job.yaml \
  --project="$LETTER_ARCHIVE_PROJECT_ID" \
  --region="$LETTER_ARCHIVE_REGION" \
  --quiet

export LETTER_ARCHIVE_SERVICE=letter-archive-backend
export LETTER_ARCHIVE_SERVICE_ACCOUNT="$LETTER_ARCHIVE_BACKEND_SERVICE_ACCOUNT"
export LETTER_ARCHIVE_IMAGE_REPOSITORY="$LETTER_ARCHIVE_BACKEND_IMAGE_REPOSITORY"
export LETTER_ARCHIVE_PRODUCTION_URL="$LETTER_ARCHIVE_BACKEND_PRODUCTION_URL"
export LETTER_ARCHIVE_SERVICE_MANIFEST=rendered/cloudrun/backend-service.yaml
export LETTER_ARCHIVE_WORKER_JOB_NAME="$worker_job"
bash deploy/cloudrun/promote-service.sh

# The backend and worker are now one committed release unit. Do not restore the
# old jobs if a later frontend-only promotion fails.
backend_committed=true
resume_scheduler
rollback_jobs=false

export LETTER_ARCHIVE_SERVICE=letter-archive-frontend
export LETTER_ARCHIVE_SERVICE_ACCOUNT="$LETTER_ARCHIVE_FRONTEND_SERVICE_ACCOUNT"
export LETTER_ARCHIVE_IMAGE_REPOSITORY="$LETTER_ARCHIVE_FRONTEND_IMAGE_REPOSITORY"
export LETTER_ARCHIVE_PRODUCTION_URL="$LETTER_ARCHIVE_FRONTEND_PRODUCTION_URL"
export LETTER_ARCHIVE_SERVICE_MANIFEST=rendered/cloudrun/frontend-service.yaml
unset LETTER_ARCHIVE_WORKER_JOB_NAME
bash deploy/cloudrun/promote-service.sh

trap - EXIT
echo "Full production release completed"
