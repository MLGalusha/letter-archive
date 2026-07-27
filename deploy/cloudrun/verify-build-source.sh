#!/usr/bin/env bash

set -euo pipefail

required_variables=(
  LETTER_ARCHIVE_PROJECT_ID
  LETTER_ARCHIVE_BUILD_LOCATION
  LETTER_ARCHIVE_BUILD_ID
  LETTER_ARCHIVE_RELEASE_SHA
)
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Missing build source verification value: $variable_name" >&2
    exit 1
  fi
done

if [[ ! "$LETTER_ARCHIVE_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Release SHA must be a full lowercase Git commit SHA" >&2
  exit 1
fi
if [[ ! "$LETTER_ARCHIVE_PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
  echo "Build project ID is invalid" >&2
  exit 1
fi
if [[ ! "$LETTER_ARCHIVE_BUILD_LOCATION" =~ ^[a-z]+-[a-z0-9]+[0-9]$ ]]; then
  echo "Build location is invalid" >&2
  exit 1
fi
if [[ ! "$LETTER_ARCHIVE_BUILD_ID" =~ ^[0-9a-f-]{8,64}$ ]]; then
  echo "Build ID contains unexpected characters" >&2
  exit 1
fi

resolved_revision="$(
  gcloud builds describe "$LETTER_ARCHIVE_BUILD_ID" \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --region="$LETTER_ARCHIVE_BUILD_LOCATION" \
    --format='value(sourceProvenance.resolvedGitSource.revision)'
)"

if [[ "$resolved_revision" != "$LETTER_ARCHIVE_RELEASE_SHA" ]]; then
  echo "Build source revision does not match the requested release SHA" >&2
  echo "Expected: $LETTER_ARCHIVE_RELEASE_SHA" >&2
  echo "Resolved: ${resolved_revision:-missing}" >&2
  exit 1
fi

echo "Verified build source revision $resolved_revision"
