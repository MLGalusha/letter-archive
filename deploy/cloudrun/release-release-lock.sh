#!/usr/bin/env bash

set -euo pipefail

: "${LETTER_ARCHIVE_PROJECT_ID:?Missing LETTER_ARCHIVE_PROJECT_ID}"
: "${LETTER_ARCHIVE_BUILD_ID:?Missing LETTER_ARCHIVE_BUILD_ID}"
: "${LETTER_ARCHIVE_RELEASE_SHA:?Missing LETTER_ARCHIVE_RELEASE_SHA}"
: "${LETTER_ARCHIVE_RELEASE_LOCK_BUCKET:?Missing LETTER_ARCHIVE_RELEASE_LOCK_BUCKET}"

lock_uri="gs://${LETTER_ARCHIVE_RELEASE_LOCK_BUCKET}/production.lock"
expected_payload="${LETTER_ARCHIVE_BUILD_ID} ${LETTER_ARCHIVE_RELEASE_SHA}"
current_payload="$(
  gcloud storage cat "$lock_uri" \
    --project="$LETTER_ARCHIVE_PROJECT_ID"
)"
if [[ "$current_payload" != "$expected_payload" ]]; then
  echo "Refusing to release a production lock owned by another build" >&2
  exit 1
fi

lock_generation="$(
  gcloud storage objects describe "$lock_uri" \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --format='value(generation)'
)"
if [[ ! "$lock_generation" =~ ^[0-9]+$ ]]; then
  echo "Production release lock generation is invalid" >&2
  exit 1
fi

gcloud storage rm "$lock_uri" \
  --project="$LETTER_ARCHIVE_PROJECT_ID" \
  --if-generation-match="$lock_generation"
echo "Released production lock for build $LETTER_ARCHIVE_BUILD_ID"
