#!/usr/bin/env bash

set -euo pipefail

: "${LETTER_ARCHIVE_RELEASE_SHA:?Missing LETTER_ARCHIVE_RELEASE_SHA}"

if [[ ! "$LETTER_ARCHIVE_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Release SHA must be a full lowercase Git commit SHA" >&2
  exit 1
fi

current_main="$(
  git ls-remote \
    https://github.com/MLGalusha/letter-archive.git \
    refs/heads/main \
    | awk 'NR == 1 { print $1 }'
)"
if [[ ! "$current_main" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Could not resolve the current remote main commit" >&2
  exit 1
fi
if [[ "$current_main" != "$LETTER_ARCHIVE_RELEASE_SHA" ]]; then
  echo "Refusing stale release: main is now $current_main" >&2
  exit 1
fi

echo "Release commit is still current on main"
