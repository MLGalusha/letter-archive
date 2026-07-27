#!/usr/bin/env bash

set -euo pipefail

required_variables=(
  LETTER_ARCHIVE_PROJECT_ID
  LETTER_ARCHIVE_REGION
  LETTER_ARCHIVE_SERVICE
  LETTER_ARCHIVE_SERVICE_ACCOUNT
  LETTER_ARCHIVE_IMAGE_REPOSITORY
  LETTER_ARCHIVE_RELEASE_SHA
  LETTER_ARCHIVE_BUILD_ID
  LETTER_ARCHIVE_PRODUCTION_URL
  LETTER_ARCHIVE_SERVICE_MANIFEST
)
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Missing service promotion value: $variable_name" >&2
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
if [[ ! "$LETTER_ARCHIVE_PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
  echo "Project ID is invalid" >&2
  exit 1
fi
if [[ ! "$LETTER_ARCHIVE_REGION" =~ ^[a-z]+-[a-z0-9]+[0-9]$ ]]; then
  echo "Region is invalid" >&2
  exit 1
fi
service_account_pattern="^[a-z][a-z0-9-]{4,28}[a-z0-9]@${LETTER_ARCHIVE_PROJECT_ID}\\.iam\\.gserviceaccount\\.com$"
if [[ ! "$LETTER_ARCHIVE_SERVICE_ACCOUNT" =~ $service_account_pattern ]]; then
  echo "Service account is invalid for the release project" >&2
  exit 1
fi
image_repository_pattern="^${LETTER_ARCHIVE_REGION}-docker\\.pkg\\.dev/${LETTER_ARCHIVE_PROJECT_ID}/[a-z0-9._-]+/[a-z0-9._/-]+$"
if [[ ! "$LETTER_ARCHIVE_IMAGE_REPOSITORY" =~ $image_repository_pattern ]]; then
  echo "Image repository is invalid for the release project and region" >&2
  exit 1
fi
if [[ ! "$LETTER_ARCHIVE_PRODUCTION_URL" =~ ^https://[a-z0-9.-]+$ ]]; then
  echo "Production URL is invalid" >&2
  exit 1
fi
if [[ ! -f "$LETTER_ARCHIVE_SERVICE_MANIFEST" ]]; then
  echo "Rendered service manifest is missing" >&2
  exit 1
fi
case "$LETTER_ARCHIVE_SERVICE" in
  letter-archive-backend|letter-archive-frontend) ;;
  *)
    echo "Unsupported Letter Archive service: $LETTER_ARCHIVE_SERVICE" >&2
    exit 1
    ;;
esac

tagged_image="${LETTER_ARCHIVE_IMAGE_REPOSITORY}:${LETTER_ARCHIVE_RELEASE_SHA}"
image_digest="$(
  gcloud artifacts docker images describe "$tagged_image" \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --format='value(image_summary.digest)'
)"
if [[ ! "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Could not resolve an immutable digest for $tagged_image" >&2
  exit 1
fi
image_reference="${LETTER_ARCHIVE_IMAGE_REPOSITORY}@${image_digest}"
if ! grep -Fqx "        - image: ${image_reference}" \
  "$LETTER_ARCHIVE_SERVICE_MANIFEST"; then
  echo "Rendered service manifest does not contain the release image digest" >&2
  exit 1
fi
if ! grep -Fqx "      serviceAccountName: ${LETTER_ARCHIVE_SERVICE_ACCOUNT}" \
  "$LETTER_ARCHIVE_SERVICE_MANIFEST"; then
  echo "Rendered service manifest does not contain the release identity" >&2
  exit 1
fi

service_state="$(
  gcloud run services describe "$LETTER_ARCHIVE_SERVICE" \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --region="$LETTER_ARCHIVE_REGION" \
    --format=json
)"
previous_revision="$(
  python3 -c '
import json
import sys
state = json.load(sys.stdin)
traffic = [
    item for item in state.get("status", {}).get("traffic", [])
    if int(item.get("percent", 0)) > 0
]
if len(traffic) != 1 or int(traffic[0].get("percent", 0)) != 100:
    raise SystemExit("service must have exactly one 100% traffic revision")
revision = traffic[0].get("revisionName")
if not revision:
    raise SystemExit("serving revision name is missing")
print(revision)
' <<<"$service_state"
)"

release_prefix="${LETTER_ARCHIVE_RELEASE_SHA:0:10}"
tag_release_prefix="${LETTER_ARCHIVE_RELEASE_SHA:0:8}"
build_prefix="${LETTER_ARCHIVE_BUILD_ID:0:8}"
candidate_tag="c-${tag_release_prefix}-${build_prefix}"
candidate_revision="${LETTER_ARCHIVE_SERVICE}-r-${release_prefix}-${build_prefix}"
candidate_manifest="${LETTER_ARCHIVE_SERVICE_MANIFEST%.yaml}.candidate.yaml"
export LETTER_ARCHIVE_PREVIOUS_REVISION="$previous_revision"
export LETTER_ARCHIVE_CANDIDATE_REVISION="$candidate_revision"
export LETTER_ARCHIVE_CANDIDATE_TAG="$candidate_tag"
bash deploy/cloudrun/prepare-candidate-manifest.sh \
  "$LETTER_ARCHIVE_SERVICE_MANIFEST" "$candidate_manifest"

probe_backend_once() {
  local base_url="$1"
  local health
  health="$(curl --connect-timeout 3 --max-time 10 -fsS \
    "${base_url}/health")" || return 1
  [[ "$health" == \
    "{\"ok\":true,\"releaseSha\":\"${LETTER_ARCHIVE_RELEASE_SHA}\"}" ]] \
    || return 1
  curl --connect-timeout 3 --max-time 10 -fsS \
    "${base_url}/health/ready" >/dev/null \
    && curl --connect-timeout 3 --max-time 10 -fsS \
      "${base_url}/auth/status" >/dev/null
}

probe_frontend_once() {
  local base_url="$1"
  local version
  version="$(curl --connect-timeout 3 --max-time 10 -fsS \
    "${base_url}/version.json")" || return 1
  [[ "$version" == \
    "{\"releaseSha\":\"${LETTER_ARCHIVE_RELEASE_SHA}\"}" ]] \
    || return 1
  curl --connect-timeout 3 --max-time 10 -fsS \
    "${base_url}/admin-login" >/dev/null
}

wait_for_release_probe() {
  local base_url="$1"
  for attempt in $(seq 1 24); do
    if [[ "$LETTER_ARCHIVE_SERVICE" == letter-archive-backend ]]; then
      if probe_backend_once "$base_url"; then return 0; fi
    elif probe_frontend_once "$base_url"; then
      return 0
    fi
    if (( attempt % 6 == 0 )); then
      echo "Waiting for $LETTER_ARCHIVE_SERVICE release identity ($attempt/24)"
    fi
    sleep 5
  done
  echo "Release identity probe failed for $base_url" >&2
  return 1
}

probe_restored_service() {
  if [[ "$LETTER_ARCHIVE_SERVICE" == letter-archive-backend ]]; then
    curl --connect-timeout 3 --max-time 10 -fsS \
      "${LETTER_ARCHIVE_PRODUCTION_URL}/health" >/dev/null \
      && curl --connect-timeout 3 --max-time 10 -fsS \
        "${LETTER_ARCHIVE_PRODUCTION_URL}/health/ready" >/dev/null \
      && curl --connect-timeout 3 --max-time 10 -fsS \
        "${LETTER_ARCHIVE_PRODUCTION_URL}/auth/status" >/dev/null
  else
    curl --connect-timeout 3 --max-time 10 -fsS \
      "${LETTER_ARCHIVE_PRODUCTION_URL}/admin-login" >/dev/null
  fi
}

traffic_is_restored() {
  gcloud run services describe "$LETTER_ARCHIVE_SERVICE" \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --region="$LETTER_ARCHIVE_REGION" \
    --format=json \
    | python3 -c '
import json
import sys
expected = sys.argv[1]
state = json.load(sys.stdin)
traffic = [
    item for item in state.get("status", {}).get("traffic", [])
    if int(item.get("percent", 0)) > 0
]
if len(traffic) != 1:
    raise SystemExit(1)
item = traffic[0]
if item.get("revisionName") != expected or int(item.get("percent", 0)) != 100:
    raise SystemExit(1)
' "$previous_revision"
}

candidate_created=false
promoted=false

cleanup_failed_candidate() {
  local exit_code="$?"
  trap - EXIT
  if [[ "$exit_code" -eq 0 ]]; then return; fi

  if [[ "$promoted" == true ]]; then
    echo "Release failed after promotion; restoring $previous_revision" >&2
    rollback_complete=false
    for attempt in $(seq 1 10); do
      gcloud run services update-traffic "$LETTER_ARCHIVE_SERVICE" \
        --project="$LETTER_ARCHIVE_PROJECT_ID" \
        --region="$LETTER_ARCHIVE_REGION" \
        --to-revisions="${previous_revision}=100" \
        --remove-tags="$candidate_tag" \
        --quiet || true
      if traffic_is_restored && probe_restored_service; then
        rollback_complete=true
        break
      fi
      sleep 3
    done
    if [[ "$rollback_complete" != true ]]; then
      echo "CRITICAL: production traffic rollback could not be verified" >&2
      exit 70
    fi
  elif [[ "$candidate_created" == true ]]; then
    tag_removed=false
    for attempt in 1 2 3; do
      if gcloud run services update-traffic "$LETTER_ARCHIVE_SERVICE" \
        --project="$LETTER_ARCHIVE_PROJECT_ID" \
        --region="$LETTER_ARCHIVE_REGION" \
        --remove-tags="$candidate_tag" \
        --quiet; then
        tag_removed=true
        break
      fi
      sleep "$attempt"
    done
    if [[ "$tag_removed" != true ]]; then
      echo "CRITICAL: failed candidate tag could not be removed" >&2
      exit 71
    fi
  fi
  exit "$exit_code"
}
trap cleanup_failed_candidate EXIT

gcloud run services replace "$candidate_manifest" \
  --project="$LETTER_ARCHIVE_PROJECT_ID" \
  --region="$LETTER_ARCHIVE_REGION" \
  --quiet
candidate_created=true

service_state="$(
  gcloud run services describe "$LETTER_ARCHIVE_SERVICE" \
    --project="$LETTER_ARCHIVE_PROJECT_ID" \
    --region="$LETTER_ARCHIVE_REGION" \
    --format=json
)"
candidate_url="$(
  python3 -c '
import json
import sys
tag = sys.argv[1]
revision = sys.argv[2]
state = json.load(sys.stdin)
matches = [
    item for item in state.get("status", {}).get("traffic", [])
    if item.get("tag") == tag and item.get("revisionName") == revision
]
if len(matches) != 1 or not matches[0].get("url"):
    raise SystemExit("candidate URL was not published")
print(matches[0]["url"])
' "$candidate_tag" "$candidate_revision" <<<"$service_state"
)"

wait_for_release_probe "$candidate_url"

promoted=true
gcloud run services update-traffic "$LETTER_ARCHIVE_SERVICE" \
  --project="$LETTER_ARCHIVE_PROJECT_ID" \
  --region="$LETTER_ARCHIVE_REGION" \
  --to-tags="${candidate_tag}=100" \
  --quiet

wait_for_release_probe "$LETTER_ARCHIVE_PRODUCTION_URL"

gcloud run services update-traffic "$LETTER_ARCHIVE_SERVICE" \
  --project="$LETTER_ARCHIVE_PROJECT_ID" \
  --region="$LETTER_ARCHIVE_REGION" \
  --to-revisions="${candidate_revision}=100" \
  --remove-tags="$candidate_tag" \
  --quiet

ensure_job_invoker() {
  local service_account="$1"
  for attempt in 1 2 3; do
    gcloud run jobs add-iam-policy-binding "$LETTER_ARCHIVE_WORKER_JOB_NAME" \
      --project="$LETTER_ARCHIVE_PROJECT_ID" \
      --region="$LETTER_ARCHIVE_REGION" \
      --member="serviceAccount:${service_account}" \
      --role=roles/run.invoker \
      --quiet || true
    if gcloud run jobs get-iam-policy "$LETTER_ARCHIVE_WORKER_JOB_NAME" \
      --project="$LETTER_ARCHIVE_PROJECT_ID" \
      --region="$LETTER_ARCHIVE_REGION" \
      --format=json \
      | LETTER_ARCHIVE_EXPECTED_MEMBER="serviceAccount:${service_account}" \
        python3 -c '
import json
import os
import sys
policy = json.load(sys.stdin)
expected = os.environ["LETTER_ARCHIVE_EXPECTED_MEMBER"]
for binding in policy.get("bindings", []):
    if binding.get("role") == "roles/run.invoker" and expected in binding.get("members", []):
        raise SystemExit(0)
raise SystemExit(1)
'; then
      return 0
    fi
    sleep "$attempt"
  done
  return 1
}

if [[ "$LETTER_ARCHIVE_SERVICE" == letter-archive-backend ]]; then
  : "${LETTER_ARCHIVE_WORKER_JOB_NAME:?Missing LETTER_ARCHIVE_WORKER_JOB_NAME}"
  : "${LETTER_ARCHIVE_WORKER_SERVICE_ACCOUNT:?Missing LETTER_ARCHIVE_WORKER_SERVICE_ACCOUNT}"
  # Restore worker self-handoff first. The backend remains unable to launch a
  # writer until its own binding is the final committed cutover action.
  ensure_job_invoker "$LETTER_ARCHIVE_WORKER_SERVICE_ACCOUNT"
  ensure_job_invoker "$LETTER_ARCHIVE_SERVICE_ACCOUNT"
fi

promoted=false
candidate_created=false
trap - EXIT
echo "Promoted $LETTER_ARCHIVE_SERVICE revision $candidate_revision"
