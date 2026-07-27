#!/usr/bin/env bash

set -euo pipefail

required_variables=(
  LETTER_ARCHIVE_PROJECT_ID
  LETTER_ARCHIVE_REGION
  LETTER_ARCHIVE_RELEASE_SHA
  LETTER_ARCHIVE_BUILD_ID
  LETTER_ARCHIVE_RELEASE_LOCK_BUCKET
)
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Missing release lock value: $variable_name" >&2
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
if [[ ! "$LETTER_ARCHIVE_RELEASE_LOCK_BUCKET" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]]; then
  echo "Release lock bucket name is invalid" >&2
  exit 1
fi

lock_uri="gs://${LETTER_ARCHIVE_RELEASE_LOCK_BUCKET}/production.lock"
lock_payload="${LETTER_ARCHIVE_BUILD_ID} ${LETTER_ARCHIVE_RELEASE_SHA}"

for attempt in $(seq 1 180); do
  if printf '%s\n' "$lock_payload" \
    | gcloud storage cp - "$lock_uri" \
      --project="$LETTER_ARCHIVE_PROJECT_ID" \
      --if-generation-match=0 >/dev/null 2>&1; then
    echo "Acquired production release lock for build $LETTER_ARCHIVE_BUILD_ID"
    exit 0
  fi

  # Read one immutable object version. Fetching the live payload and its
  # generation separately would allow another contender to replace the lock
  # between those reads, causing us to delete that contender's live lock.
  if ! lock_generation="$(
    gcloud storage objects describe "$lock_uri" \
      --project="$LETTER_ARCHIVE_PROJECT_ID" \
      --format='value(generation)' 2>/dev/null
  )"; then
    continue
  fi
  if [[ ! "$lock_generation" =~ ^[0-9]+$ ]]; then
    echo "Production release lock generation is invalid" >&2
    exit 1
  fi
  if ! current_payload="$(
    gcloud storage cat "${lock_uri}#${lock_generation}" \
      --project="$LETTER_ARCHIVE_PROJECT_ID" 2>/dev/null
  )"; then
    # The observed generation stopped being readable before its payload was
    # fetched. Re-observe instead of making a decision about a different lock.
    continue
  fi
  read -r owner_build_id owner_release_sha extra <<<"$current_payload"
  if [[ ! "$owner_build_id" =~ ^[0-9a-f-]{8,64}$ ]] \
    || [[ ! "$owner_release_sha" =~ ^[0-9a-f]{40}$ ]] \
    || [[ -n "${extra:-}" ]]; then
    echo "Production release lock has invalid ownership data" >&2
    exit 1
  fi

  owner_status="$(
    gcloud builds describe "$owner_build_id" \
      --project="$LETTER_ARCHIVE_PROJECT_ID" \
      --region="$LETTER_ARCHIVE_REGION" \
      --format='value(status)' 2>/dev/null || true
  )"
  case "$owner_status" in
    PENDING|QUEUED|WORKING)
      if (( attempt % 6 == 0 )); then
        echo "Waiting for production release build $owner_build_id ($owner_status)"
      fi
      sleep 10
      ;;
    SUCCESS|FAILURE|INTERNAL_ERROR|TIMEOUT|CANCELLED|EXPIRED)
      gcloud storage rm "$lock_uri" \
        --project="$LETTER_ARCHIVE_PROJECT_ID" \
        --if-generation-match="$lock_generation" >/dev/null 2>&1 || true
      ;;
    *)
      echo "Cannot prove release lock owner state for build $owner_build_id" >&2
      exit 1
      ;;
  esac
done

echo "Timed out waiting for the production release lock" >&2
exit 1
