#!/usr/bin/env bash

set -euo pipefail

required_variables=(
  LETTER_ARCHIVE_PROJECT_ID
  LETTER_ARCHIVE_REGION
  LETTER_ARCHIVE_RELEASE_SHA
  LETTER_ARCHIVE_FRONTEND_IMAGE_REPOSITORY
  LETTER_ARCHIVE_FRONTEND_SERVICE_ACCOUNT
  LETTER_ARCHIVE_BACKEND_SERVICE_ACCOUNT
  LETTER_ARCHIVE_WORKER_SERVICE_ACCOUNT
  LETTER_ARCHIVE_BUILD_ID
)
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Missing production quiescence value: $variable_name" >&2
    exit 1
  fi
done

if [[ ! "$LETTER_ARCHIVE_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Release SHA must be a full lowercase Git commit SHA" >&2
  exit 1
fi
if [[ ! "$LETTER_ARCHIVE_BUILD_ID" =~ ^[0-9a-f-]{8,64}$ ]]; then
  echo "Build ID contains unexpected characters" >&2
  exit 1
fi

tagged_frontend="$(
  printf '%s:%s' \
    "$LETTER_ARCHIVE_FRONTEND_IMAGE_REPOSITORY" \
    "$LETTER_ARCHIVE_RELEASE_SHA"
)"
frontend_digest="$(
  gcloud artifacts docker images describe "$tagged_frontend" \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --format='value(image_summary.digest)'
)"
if [[ ! "$frontend_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Could not resolve the maintenance image digest" >&2
  exit 1
fi
maintenance_image="${LETTER_ARCHIVE_FRONTEND_IMAGE_REPOSITORY}@${frontend_digest}"

# Pause scheduled reconciliation before revoking direct wake authority.
if gcloud services list \
  --project="$LETTER_ARCHIVE_PROJECT_ID" \
  --enabled \
  --filter='config.name=cloudscheduler.googleapis.com' \
  --format='value(config.name)' \
  | grep -qx 'cloudscheduler.googleapis.com'; then
  if gcloud scheduler jobs describe letter-archive-worker-reconcile \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --location="$LETTER_ARCHIVE_REGION" >/dev/null 2>&1; then
    gcloud scheduler jobs pause letter-archive-worker-reconcile \
      --project="$LETTER_ARCHIVE_PROJECT_ID" \
      --location="$LETTER_ARCHIVE_REGION" \
      --quiet
  fi
fi

# Revoke the old backend's wake and the old worker's exit-handoff authority
# before draining requests. Either path could otherwise launch another writer
# near the end of Cloud Run's request-drain window.
worker_job="$(
  gcloud run jobs list \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --region="$LETTER_ARCHIVE_REGION" \
    --filter='metadata.name=letter-archive-worker' \
    --format='value(metadata.name)'
)"
if [[ -n "$worker_job" ]]; then
  for service_account in \
    "$LETTER_ARCHIVE_BACKEND_SERVICE_ACCOUNT" \
    "$LETTER_ARCHIVE_WORKER_SERVICE_ACCOUNT"; do
    gcloud run jobs remove-iam-policy-binding letter-archive-worker \
      --project="$LETTER_ARCHIVE_PROJECT_ID" \
      --region="$LETTER_ARCHIVE_REGION" \
      --member="serviceAccount:${service_account}" \
      --role=roles/run.invoker \
      --quiet || true
  done

  gcloud run jobs get-iam-policy letter-archive-worker \
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
        raise SystemExit("backend can still invoke the worker job")
    if os.environ["LETTER_ARCHIVE_WORKER_MEMBER"] in members:
        raise SystemExit("worker can still hand off to another execution")
'
fi

# Block new unauthenticated API requests before moving traffic. Ignore a
# missing binding only if the policy read below proves public invocation is off.
gcloud run services remove-iam-policy-binding letter-archive-backend \
  --project="$LETTER_ARCHIVE_PROJECT_ID" \
  --region="$LETTER_ARCHIVE_REGION" \
  --member=allUsers \
  --role=roles/run.invoker \
  --quiet || true

gcloud run services get-iam-policy letter-archive-backend \
  --project="$LETTER_ARCHIVE_PROJECT_ID" \
  --region="$LETTER_ARCHIVE_REGION" \
  --format=json \
  | python3 -c '
import json
import sys
policy = json.load(sys.stdin)
public = {"allUsers", "allAuthenticatedUsers"}
for binding in policy.get("bindings", []):
    if binding.get("role") != "roles/run.invoker":
        continue
    if public.intersection(binding.get("members", [])):
        raise SystemExit("backend still has a public invoker binding")
'

# Use the already-built static frontend image as a maintenance revision. Clear
# backend-only configuration so this revision cannot reach the database,
# secrets, archive bucket, or worker job.
maintenance_suffix="maintenance-${LETTER_ARCHIVE_RELEASE_SHA:0:8}-${LETTER_ARCHIVE_BUILD_ID:0:8}"
gcloud run deploy letter-archive-backend \
  --project="$LETTER_ARCHIVE_PROJECT_ID" \
  --region="$LETTER_ARCHIVE_REGION" \
  --image="$maintenance_image" \
  --service-account="$LETTER_ARCHIVE_FRONTEND_SERVICE_ACCOUNT" \
  --revision-suffix="$maintenance_suffix" \
  --no-traffic \
  --clear-env-vars \
  --clear-secrets \
  --clear-cloudsql-instances \
  --clear-volume-mounts \
  --clear-volumes \
  --startup-probe="" \
  --port=8080 \
  --quiet

maintenance_revision="$(
  gcloud run services describe letter-archive-backend \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --region="$LETTER_ARCHIVE_REGION" \
    --format='value(status.latestCreatedRevisionName)'
)"
if [[ "$maintenance_revision" != \
  "letter-archive-backend-${maintenance_suffix}" ]]; then
  echo "Unexpected maintenance revision: $maintenance_revision" >&2
  exit 1
fi

gcloud run services update-traffic letter-archive-backend \
  --project="$LETTER_ARCHIVE_PROJECT_ID" \
  --region="$LETTER_ARCHIVE_REGION" \
  --to-revisions="${maintenance_revision}=100" \
  --quiet

legacy_pool="$(
  gcloud beta run worker-pools list \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --region="$LETTER_ARCHIVE_REGION" \
    --filter='metadata.name=letter-archive-worker' \
    --format='value(metadata.name)'
)"
if [[ -n "$legacy_pool" ]]; then
  gcloud beta run worker-pools delete letter-archive-worker \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --region="$LETTER_ARCHIVE_REGION" \
    --quiet
fi

# Cloud Run traffic transitions are not instantaneous. Wait longer than the
# old backend's 300-second request timeout so every pre-maintenance request has
# finished before the incompatible migration begins.
for interval in $(seq 1 31); do
  if (( interval % 6 == 0 )); then
    echo "Waiting for pre-maintenance API requests to drain ($interval/31)"
  fi
  sleep 10
done

# With every worker wake path disabled and old API requests drained, require
# worker executions to finish before allowing the migration step to start.
if [[ -n "$worker_job" ]]; then
  worker_drained=false
  zero_observations=0
  for interval in $(seq 1 30); do
    active_executions="$(
      gcloud run jobs executions list \
        --project="$LETTER_ARCHIVE_PROJECT_ID" \
        --region="$LETTER_ARCHIVE_REGION" \
        --job=letter-archive-worker \
        --format=json \
        | python3 -c '
import json
import sys
executions = json.load(sys.stdin)
active = [
    item.get("metadata", {}).get("name", "unknown")
    for item in executions
    if not item.get("status", {}).get("completionTime")
]
print("\n".join(active))
'
    )"
    if [[ -z "$active_executions" ]]; then
      zero_observations="$((zero_observations + 1))"
      if [[ "$zero_observations" -ge 2 ]]; then
        worker_drained=true
        break
      fi
    else
      zero_observations=0
    fi
    if (( interval % 6 == 0 )); then
      echo "Waiting for active worker executions to drain ($interval/30)"
      echo "$active_executions"
    fi
    sleep 10
  done
  if [[ "$worker_drained" != "true" ]]; then
    echo "Active worker executions did not drain before migration:" >&2
    echo "$active_executions" >&2
    exit 1
  fi
fi

echo "Letter Archive production writers are quiescent"
