#!/usr/bin/env bash

set -euo pipefail

backend_revision="${1:-}"
frontend_revision="${2:-}"
head_revision="${3:-}"

sha_pattern='^[0-9a-f]{40}$'
if [[ ! "$head_revision" =~ $sha_pattern ]]; then
  echo "full"
  exit 0
fi
if ! git cat-file -e "${head_revision}^{commit}" 2>/dev/null; then
  echo "full"
  exit 0
fi

# GitHub concurrency prevents overlap while both controller jobs are alive, but
# it does not guarantee commit order. An older workflow must never roll back a
# newer release that reached either service first.
for deployed_revision in "$backend_revision" "$frontend_revision"; do
  if [[ ! "$deployed_revision" =~ $sha_pattern ]]; then
    continue
  fi
  if ! git cat-file -e "${deployed_revision}^{commit}" 2>/dev/null; then
    continue
  fi
  if [[ "$deployed_revision" != "$head_revision" ]] \
    && git merge-base --is-ancestor "$head_revision" "$deployed_revision"; then
    echo "stale"
    exit 0
  fi
done

if [[ ! "$backend_revision" =~ $sha_pattern ]]; then
  echo "full"
  exit 0
fi
if ! git cat-file -e "${backend_revision}^{commit}" 2>/dev/null; then
  echo "full"
  exit 0
fi

while IFS= read -r changed_file; do
  case "$changed_file" in
    backend/*|deploy/*|cloudbuild.release.yaml|cloudbuild.deploy.yaml|.github/workflows/ci.yml)
      echo "full"
      exit 0
      ;;
  esac
done < <(git diff --name-only "$backend_revision" "$head_revision")

if [[ ! "$frontend_revision" =~ $sha_pattern ]]; then
  echo "full"
  exit 0
fi
if ! git cat-file -e "${frontend_revision}^{commit}" 2>/dev/null; then
  echo "full"
  exit 0
fi
if [[ "$backend_revision" == "$head_revision" \
  && "$frontend_revision" != "$head_revision" ]] \
  && git merge-base --is-ancestor "$frontend_revision" "$head_revision"; then
  echo "frontend"
  exit 0
fi

while IFS= read -r changed_file; do
  case "$changed_file" in
    frontend/*|cloudbuild.frontend-release.yaml)
      echo "frontend"
      exit 0
      ;;
  esac
done < <(git diff --name-only "$frontend_revision" "$head_revision")

echo "none"
