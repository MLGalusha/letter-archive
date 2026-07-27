#!/usr/bin/env bash

set -euo pipefail

template_directory="${1:-deploy/cloudrun}"
output_directory="${2:-rendered/cloudrun}"
shift "$(( $# >= 2 ? 2 : $# ))"

if [[ ! -d "$template_directory" ]]; then
  echo "Cloud Run manifest template directory does not exist: $template_directory" >&2
  exit 1
fi
if [[ "$template_directory" == "$output_directory" ]]; then
  echo "Cloud Run manifests must render to a separate output directory" >&2
  exit 1
fi
if [[ -e "$output_directory" ]]; then
  echo "Cloud Run manifest output already exists: $output_directory" >&2
  exit 1
fi

validate_render_value() {
  local variable_name="$1"
  local expected_pattern="$2"
  local variable_value="${!variable_name:-}"

  if [[ -z "$variable_value" ]]; then
    echo "Missing required manifest render value: $variable_name" >&2
    exit 1
  fi
  if [[ ! "$variable_value" =~ $expected_pattern ]]; then
    echo "Invalid manifest render value: $variable_name" >&2
    exit 1
  fi
}

shopt -s nullglob
if [[ "$#" -gt 0 ]]; then
  template_files=()
  for template_name in "$@"; do
    if [[ ! "$template_name" =~ ^[a-z0-9-]+\.yaml$ ]]; then
      echo "Invalid Cloud Run manifest template name: $template_name" >&2
      exit 1
    fi
    template_file="$template_directory/$template_name"
    if [[ ! -f "$template_file" ]]; then
      echo "Cloud Run manifest template does not exist: $template_file" >&2
      exit 1
    fi
    template_files+=("$template_file")
  done
else
  template_files=("$template_directory"/*.yaml)
fi
if [[ "${#template_files[@]}" -eq 0 ]]; then
  echo "No Cloud Run YAML manifest templates found in: $template_directory" >&2
  exit 1
fi

templates_require() {
  local placeholder="$1"
  grep -q "$placeholder" "${template_files[@]}"
}

project_id_pattern='^[a-z][a-z0-9-]{4,28}[a-z0-9]$'
service_account_pattern="^[a-z][a-z0-9-]{4,28}[a-z0-9]@${project_id_pattern:1:-1}\\.iam\\.gserviceaccount\\.com$"
image_pattern='^[a-z0-9.-]+-docker\.pkg\.dev/[a-z][a-z0-9-]{4,28}[a-z0-9]/[a-z0-9._-]+/[a-z0-9._/-]+(:[A-Za-z0-9._-]+|@sha256:[0-9a-f]{64})$'

if templates_require '__PROJECT_ID__'; then
  validate_render_value LETTER_ARCHIVE_PROJECT_ID "$project_id_pattern"
fi
if templates_require '__REGION__'; then
  validate_render_value LETTER_ARCHIVE_REGION '^[a-z]+-[a-z0-9]+[0-9]$'
fi
if templates_require '__CLOUD_SQL_INSTANCE__'; then
  validate_render_value LETTER_ARCHIVE_CLOUD_SQL_INSTANCE \
    '^[a-z][a-z0-9-]{0,96}[a-z0-9]$'
fi
if templates_require '__ARCHIVE_BUCKET__'; then
  validate_render_value LETTER_ARCHIVE_ARCHIVE_BUCKET \
    '^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$'
fi
if templates_require '__DOMAIN__'; then
  validate_render_value LETTER_ARCHIVE_DOMAIN \
    '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
fi
if templates_require '__BACKEND_SERVICE_ACCOUNT__'; then
  validate_render_value LETTER_ARCHIVE_BACKEND_SERVICE_ACCOUNT \
    "$service_account_pattern"
fi
if templates_require '__FRONTEND_SERVICE_ACCOUNT__'; then
  validate_render_value LETTER_ARCHIVE_FRONTEND_SERVICE_ACCOUNT \
    "$service_account_pattern"
fi
if templates_require '__WORKER_SERVICE_ACCOUNT__'; then
  validate_render_value LETTER_ARCHIVE_WORKER_SERVICE_ACCOUNT \
    "$service_account_pattern"
fi
if templates_require '__MIGRATE_SERVICE_ACCOUNT__'; then
  validate_render_value LETTER_ARCHIVE_MIGRATE_SERVICE_ACCOUNT \
    "$service_account_pattern"
fi
if templates_require '__BACKFILL_SERVICE_ACCOUNT__'; then
  validate_render_value LETTER_ARCHIVE_BACKFILL_SERVICE_ACCOUNT \
    "$service_account_pattern"
fi
if templates_require '__MIGRATION_RELEASE_MODE__'; then
  validate_render_value LETTER_ARCHIVE_MIGRATION_RELEASE_MODE \
    '^(automatic|maintenance)$'
fi
if templates_require '__RELEASE_SHA__'; then
  validate_render_value LETTER_ARCHIVE_RELEASE_SHA '^[0-9a-f]{40}$'
fi
if templates_require '__BACKEND_IMAGE__'; then
  validate_render_value LETTER_ARCHIVE_BACKEND_IMAGE "$image_pattern"
fi
if templates_require '__FRONTEND_IMAGE__'; then
  validate_render_value LETTER_ARCHIVE_FRONTEND_IMAGE "$image_pattern"
fi

output_parent="$(dirname "$output_directory")"
mkdir -p "$output_parent"
staging_directory="$(mktemp -d "$output_parent/.cloudrun-render.XXXXXX")"

cleanup_staging_directory() {
  local staged_files=("$staging_directory"/*)
  for staged_file in "${staged_files[@]}"; do
    rm -f -- "$staged_file"
  done
  rmdir -- "$staging_directory" 2>/dev/null || true
}
trap cleanup_staging_directory EXIT

for template_file in "${template_files[@]}"; do
  rendered_file="$staging_directory/$(basename "$template_file")"
  sed \
    -e "s|__PROJECT_ID__|${LETTER_ARCHIVE_PROJECT_ID:-}|g" \
    -e "s|__REGION__|${LETTER_ARCHIVE_REGION:-}|g" \
    -e "s|__CLOUD_SQL_INSTANCE__|${LETTER_ARCHIVE_CLOUD_SQL_INSTANCE:-}|g" \
    -e "s|__ARCHIVE_BUCKET__|${LETTER_ARCHIVE_ARCHIVE_BUCKET:-}|g" \
    -e "s|__DOMAIN__|${LETTER_ARCHIVE_DOMAIN:-}|g" \
    -e "s|__BACKEND_SERVICE_ACCOUNT__|${LETTER_ARCHIVE_BACKEND_SERVICE_ACCOUNT:-}|g" \
    -e "s|__FRONTEND_SERVICE_ACCOUNT__|${LETTER_ARCHIVE_FRONTEND_SERVICE_ACCOUNT:-}|g" \
    -e "s|__WORKER_SERVICE_ACCOUNT__|${LETTER_ARCHIVE_WORKER_SERVICE_ACCOUNT:-}|g" \
    -e "s|__MIGRATE_SERVICE_ACCOUNT__|${LETTER_ARCHIVE_MIGRATE_SERVICE_ACCOUNT:-}|g" \
    -e "s|__BACKFILL_SERVICE_ACCOUNT__|${LETTER_ARCHIVE_BACKFILL_SERVICE_ACCOUNT:-}|g" \
    -e "s|__MIGRATION_RELEASE_MODE__|${LETTER_ARCHIVE_MIGRATION_RELEASE_MODE:-}|g" \
    -e "s|__RELEASE_SHA__|${LETTER_ARCHIVE_RELEASE_SHA:-}|g" \
    -e "s|__BACKEND_IMAGE__|${LETTER_ARCHIVE_BACKEND_IMAGE:-}|g" \
    -e "s|__FRONTEND_IMAGE__|${LETTER_ARCHIVE_FRONTEND_IMAGE:-}|g" \
    "$template_file" > "$rendered_file"
done

rendered_files=("$staging_directory"/*.yaml)
unresolved_placeholder_pattern='__[A-Z][A-Z0-9_]*__|(^|[^A-Z0-9_])(PROJECT_NUMBER|PROJECT_ID|REGION|CLOUD_SQL_INSTANCE|ARCHIVE_BUCKET|YOUR_DOMAIN|SERVICE_ACCOUNT_EMAIL|BACKEND_IMAGE|FRONTEND_IMAGE)([^A-Z0-9_]|$)'

if grep -nE "$unresolved_placeholder_pattern" "${rendered_files[@]}"; then
  echo "Unresolved Cloud Run manifest placeholders remain after rendering" >&2
  exit 1
fi

mv "$staging_directory" "$output_directory"
trap - EXIT
