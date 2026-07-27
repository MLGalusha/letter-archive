#!/usr/bin/env bash

set -euo pipefail

required_variables=(
  LETTER_ARCHIVE_PROJECT_ID
  LETTER_ARCHIVE_REGION
  LETTER_ARCHIVE_RELEASE_SHA
  LETTER_ARCHIVE_FRONTEND_IMAGE_REPOSITORY
  LETTER_ARCHIVE_DOMAIN
  LETTER_ARCHIVE_FRONTEND_SERVICE_ACCOUNT
)
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Missing frontend release manifest value: $variable_name" >&2
    exit 1
  fi
done

tagged_image="${LETTER_ARCHIVE_FRONTEND_IMAGE_REPOSITORY}:${LETTER_ARCHIVE_RELEASE_SHA}"
digest="$(
  gcloud artifacts docker images describe "$tagged_image" \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --format='value(image_summary.digest)'
)"
if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Could not resolve an immutable frontend digest" >&2
  exit 1
fi
export LETTER_ARCHIVE_FRONTEND_IMAGE="${LETTER_ARCHIVE_FRONTEND_IMAGE_REPOSITORY}@${digest}"

bash deploy/cloudrun/render-manifests.sh \
  deploy/cloudrun rendered/cloudrun frontend-service.yaml
