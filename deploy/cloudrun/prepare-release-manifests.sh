#!/usr/bin/env bash

set -euo pipefail

required_variables=(
  LETTER_ARCHIVE_PROJECT_ID
  LETTER_ARCHIVE_REGION
  LETTER_ARCHIVE_RELEASE_SHA
  LETTER_ARCHIVE_BACKEND_IMAGE_REPOSITORY
  LETTER_ARCHIVE_FRONTEND_IMAGE_REPOSITORY
  LETTER_ARCHIVE_CLOUD_SQL_INSTANCE
  LETTER_ARCHIVE_ARCHIVE_BUCKET
  LETTER_ARCHIVE_DOMAIN
  LETTER_ARCHIVE_BACKEND_SERVICE_ACCOUNT
  LETTER_ARCHIVE_FRONTEND_SERVICE_ACCOUNT
  LETTER_ARCHIVE_WORKER_SERVICE_ACCOUNT
  LETTER_ARCHIVE_MIGRATE_SERVICE_ACCOUNT
  LETTER_ARCHIVE_BACKFILL_SERVICE_ACCOUNT
  LETTER_ARCHIVE_MIGRATION_RELEASE_MODE
)
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Missing release manifest value: $variable_name" >&2
    exit 1
  fi
done

resolve_digest_reference() {
  local image_repository="$1"
  local tagged_image="${image_repository}:${LETTER_ARCHIVE_RELEASE_SHA}"
  local digest

  digest="$(
    gcloud artifacts docker images describe "$tagged_image" \
      --project="$LETTER_ARCHIVE_PROJECT_ID" \
      --format='value(image_summary.digest)'
  )"
  if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "Could not resolve an immutable digest for $tagged_image" >&2
    exit 1
  fi
  printf '%s@%s' "$image_repository" "$digest"
}

export LETTER_ARCHIVE_BACKEND_IMAGE="$(
  resolve_digest_reference "$LETTER_ARCHIVE_BACKEND_IMAGE_REPOSITORY"
)"
export LETTER_ARCHIVE_FRONTEND_IMAGE="$(
  resolve_digest_reference "$LETTER_ARCHIVE_FRONTEND_IMAGE_REPOSITORY"
)"

bash deploy/cloudrun/render-manifests.sh \
  deploy/cloudrun rendered/cloudrun
