#!/usr/bin/env bash

set -euo pipefail

required_variables=(
  LETTER_ARCHIVE_PROJECT_ID
  LETTER_ARCHIVE_REGION
  LETTER_ARCHIVE_JOB_NAME
  LETTER_ARCHIVE_INVOKER_SERVICE_ACCOUNT
)
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Missing job invoker value: $variable_name" >&2
    exit 1
  fi
done

if [[ ! "$LETTER_ARCHIVE_PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
  echo "Project ID is invalid" >&2
  exit 1
fi
if [[ ! "$LETTER_ARCHIVE_REGION" =~ ^[a-z]+-[a-z0-9]+[0-9]$ ]]; then
  echo "Region is invalid" >&2
  exit 1
fi
if [[ ! "$LETTER_ARCHIVE_JOB_NAME" =~ ^letter-archive-[a-z0-9-]+$ ]]; then
  echo "Cloud Run job name is outside the Letter Archive scope" >&2
  exit 1
fi
service_account_pattern="^[a-z][a-z0-9-]{4,28}[a-z0-9]@${LETTER_ARCHIVE_PROJECT_ID}\\.iam\\.gserviceaccount\\.com$"
if [[ ! "$LETTER_ARCHIVE_INVOKER_SERVICE_ACCOUNT" =~ $service_account_pattern ]]; then
  echo "Invoker service account is invalid for the release project" >&2
  exit 1
fi

expected_member="serviceAccount:${LETTER_ARCHIVE_INVOKER_SERVICE_ACCOUNT}"

binding_exists() {
  gcloud run jobs get-iam-policy "$LETTER_ARCHIVE_JOB_NAME" \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --region="$LETTER_ARCHIVE_REGION" \
    --format=json \
    | LETTER_ARCHIVE_EXPECTED_MEMBER="$expected_member" python3 -c '
import json
import os
import sys

policy = json.load(sys.stdin)
expected = os.environ["LETTER_ARCHIVE_EXPECTED_MEMBER"]
for binding in policy.get("bindings", []):
    if binding.get("role") == "roles/run.invoker" and expected in binding.get("members", []):
        raise SystemExit(0)
raise SystemExit(1)
'
}

if binding_exists; then
  echo "$expected_member can already invoke $LETTER_ARCHIVE_JOB_NAME"
  exit 0
fi

for attempt in 1 2 3 4 5; do
  gcloud run jobs add-iam-policy-binding "$LETTER_ARCHIVE_JOB_NAME" \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --region="$LETTER_ARCHIVE_REGION" \
    --member="$expected_member" \
    --role=roles/run.invoker \
    --quiet || true

  if binding_exists; then
    echo "Verified $expected_member can invoke $LETTER_ARCHIVE_JOB_NAME"
    exit 0
  fi

  if [[ "$attempt" -lt 5 ]]; then
    echo "IAM binding retry $attempt/5 ($LETTER_ARCHIVE_JOB_NAME)"
    sleep "$((attempt * 2))"
  fi
done

echo "Failed to verify $expected_member on $LETTER_ARCHIVE_JOB_NAME" >&2
exit 1
