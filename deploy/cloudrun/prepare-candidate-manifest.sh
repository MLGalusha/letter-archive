#!/usr/bin/env bash

set -euo pipefail

source_manifest="${1:-}"
candidate_manifest="${2:-}"

: "${LETTER_ARCHIVE_SERVICE:?Missing LETTER_ARCHIVE_SERVICE}"
: "${LETTER_ARCHIVE_PREVIOUS_REVISION:?Missing LETTER_ARCHIVE_PREVIOUS_REVISION}"
: "${LETTER_ARCHIVE_CANDIDATE_REVISION:?Missing LETTER_ARCHIVE_CANDIDATE_REVISION}"
: "${LETTER_ARCHIVE_CANDIDATE_TAG:?Missing LETTER_ARCHIVE_CANDIDATE_TAG}"

name_pattern='^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
for value in \
  "$LETTER_ARCHIVE_SERVICE" \
  "$LETTER_ARCHIVE_PREVIOUS_REVISION" \
  "$LETTER_ARCHIVE_CANDIDATE_REVISION" \
  "$LETTER_ARCHIVE_CANDIDATE_TAG"; do
  if [[ ! "$value" =~ $name_pattern ]]; then
    echo "Invalid Cloud Run candidate manifest name: $value" >&2
    exit 1
  fi
done
if (( ${#LETTER_ARCHIVE_SERVICE} + 1 + ${#LETTER_ARCHIVE_CANDIDATE_TAG} > 46 )); then
  echo "Cloud Run service and candidate tag exceed the combined length limit" >&2
  exit 1
fi
if [[ ! -f "$source_manifest" || -z "$candidate_manifest" ]]; then
  echo "Candidate manifest source or destination is invalid" >&2
  exit 1
fi
if [[ -e "$candidate_manifest" ]]; then
  echo "Candidate manifest destination already exists" >&2
  exit 1
fi

awk \
  -v service="$LETTER_ARCHIVE_SERVICE" \
  -v previous="$LETTER_ARCHIVE_PREVIOUS_REVISION" \
  -v candidate="$LETTER_ARCHIVE_CANDIDATE_REVISION" \
  -v tag="$LETTER_ARCHIVE_CANDIDATE_TAG" '
  BEGIN {
    template_seen = 0
    revision_insertions = 0
    traffic_blocks = 0
    skipping_traffic = 0
  }
  $0 == "  template:" {
    template_seen = 1
    print
    next
  }
  template_seen == 1 && revision_insertions == 0 && $0 == "    metadata:" {
    print
    print "      name: " candidate
    revision_insertions++
    next
  }
  $0 == "  traffic:" {
    traffic_blocks++
    skipping_traffic = 1
    print "  traffic:"
    print "    - revisionName: " previous
    print "      percent: 100"
    print "    - revisionName: " candidate
    print "      percent: 0"
    print "      tag: " tag
    next
  }
  skipping_traffic == 1 { next }
  { print }
  END {
    if (revision_insertions != 1 || traffic_blocks != 1) {
      print "Service manifest did not have the expected template/traffic structure" > "/dev/stderr"
      exit 1
    }
  }
' "$source_manifest" > "$candidate_manifest"

if ! grep -qx "  name: ${LETTER_ARCHIVE_SERVICE}" "$candidate_manifest"; then
  echo "Candidate manifest service identity changed unexpectedly" >&2
  exit 1
fi
