#!/usr/bin/env bash
#
# setup-worktree.sh — wire a fresh git worktree for dev: isolated ports,
# matching env files, storage symlink, Claude Code launch.json, and deps.
#
# Run from inside the worktree you want to set up:
#   ./scripts/setup-worktree.sh           # picks first free port offset
#   ./scripts/setup-worktree.sh --offset 15   # force offset (frontend=5188, backend=3017)
#
# Idempotent: re-running in an already-set-up worktree updates launch.json
# and re-creates the symlink but leaves your .env files alone unless --force.

set -euo pipefail

# ── locate worktree + main ──────────────────────────────────────────────────
WORKTREE_ROOT=$(git rev-parse --show-toplevel)
MAIN_ROOT=$(git worktree list --porcelain | awk '/^worktree / { print $2; exit }')

if [[ "$WORKTREE_ROOT" == "$MAIN_ROOT" ]]; then
  echo "error: refusing to set up the main worktree ($MAIN_ROOT)."
  echo "this script is only for secondary worktrees under .claude/worktrees/."
  exit 1
fi

if [[ ! -f "$MAIN_ROOT/backend/.env" ]]; then
  echo "error: main worktree is missing backend/.env — expected at $MAIN_ROOT/backend/.env"
  echo "set up the main worktree first, then re-run this script."
  exit 1
fi

# ── parse args ──────────────────────────────────────────────────────────────
FORCE_ENV=false
FORCED_OFFSET=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --offset) FORCED_OFFSET=$2; shift 2 ;;
    --force)  FORCE_ENV=true; shift ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

# ── port selection ──────────────────────────────────────────────────────────
# Main uses frontend 5174, backend 3002. Worktree N uses 5174+N, 3002+N.
# We pick the smallest offset ≥ 10 whose port pair is free AND not already
# claimed by another worktree's backend/.env.
BASE_FRONTEND=5174
BASE_BACKEND=3002

port_in_use() {
  lsof -i ":$1" -sTCP:LISTEN >/dev/null 2>&1
}

offset_claimed_by_worktree() {
  local offset=$1
  local fe=$((BASE_FRONTEND + offset))
  local be=$((BASE_BACKEND + offset))
  for env_file in "$MAIN_ROOT"/.claude/worktrees/*/backend/.env; do
    [[ -f "$env_file" ]] || continue
    [[ "$env_file" == "$WORKTREE_ROOT/backend/.env" ]] && continue
    if grep -qE "^PORT=$be$" "$env_file" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

# On re-runs we prefer whatever is already wired up, so launch.json / env
# files don't drift. Ports are tracked independently (frontend/backend don't
# have to be symmetric — a worktree set up by hand may have picked mixed
# values). --force regenerates from a fresh offset.
FRONTEND_PORT=""
BACKEND_PORT=""

if [[ -n "$FORCED_OFFSET" ]]; then
  FRONTEND_PORT=$((BASE_FRONTEND + FORCED_OFFSET))
  BACKEND_PORT=$((BASE_BACKEND + FORCED_OFFSET))
elif [[ "$FORCE_ENV" != true ]]; then
  if [[ -f "$WORKTREE_ROOT/backend/.env" ]]; then
    EXISTING_BE=$(grep -E "^PORT=" "$WORKTREE_ROOT/backend/.env" | head -1 | cut -d= -f2 | tr -d '[:space:]')
    [[ -n "$EXISTING_BE" ]] && BACKEND_PORT=$EXISTING_BE
  fi
  if [[ -f "$WORKTREE_ROOT/frontend/.env.local" ]]; then
    EXISTING_FE=$(grep -E "^VITE_SITE_URL=" "$WORKTREE_ROOT/frontend/.env.local" | head -1 | sed -E 's|.*:([0-9]+).*|\1|')
    [[ -n "$EXISTING_FE" ]] && FRONTEND_PORT=$EXISTING_FE
  fi
fi

# Whatever's still empty: pick a fresh offset (symmetric from base).
if [[ -z "$FRONTEND_PORT" || -z "$BACKEND_PORT" ]]; then
  OFFSET=10
  while true; do
    FE=$((BASE_FRONTEND + OFFSET))
    BE=$((BASE_BACKEND + OFFSET))
    if ! port_in_use "$FE" && ! port_in_use "$BE" && ! offset_claimed_by_worktree "$OFFSET"; then
      break
    fi
    OFFSET=$((OFFSET + 1))
    if [[ $OFFSET -gt 99 ]]; then
      echo "error: could not find a free port offset in range 10..99"
      exit 1
    fi
  done
  [[ -z "$FRONTEND_PORT" ]] && FRONTEND_PORT=$((BASE_FRONTEND + OFFSET))
  [[ -z "$BACKEND_PORT" ]] && BACKEND_PORT=$((BASE_BACKEND + OFFSET))
fi

echo "worktree:     $WORKTREE_ROOT"
echo "main:         $MAIN_ROOT"
echo "frontend:     http://localhost:$FRONTEND_PORT"
echo "backend:      http://localhost:$BACKEND_PORT"
echo

# ── backend/.env ────────────────────────────────────────────────────────────
BE_ENV="$WORKTREE_ROOT/backend/.env"
if [[ -f "$BE_ENV" && "$FORCE_ENV" != true ]]; then
  echo "[skip] backend/.env already exists (use --force to overwrite)"
else
  cp "$MAIN_ROOT/backend/.env" "$BE_ENV"
  # replace PORT= line
  if grep -qE "^PORT=" "$BE_ENV"; then
    sed -i.bak -E "s|^PORT=.*|PORT=$BACKEND_PORT|" "$BE_ENV" && rm "$BE_ENV.bak"
  else
    printf '\nPORT=%s\n' "$BACKEND_PORT" >> "$BE_ENV"
  fi
  # replace or append CORS_ORIGINS
  if grep -qE "^CORS_ORIGINS=" "$BE_ENV"; then
    sed -i.bak -E "s|^CORS_ORIGINS=.*|CORS_ORIGINS=http://localhost:$FRONTEND_PORT|" "$BE_ENV" && rm "$BE_ENV.bak"
  else
    printf 'CORS_ORIGINS=http://localhost:%s\n' "$FRONTEND_PORT" >> "$BE_ENV"
  fi
  echo "[write] backend/.env (PORT=$BACKEND_PORT, CORS_ORIGINS=http://localhost:$FRONTEND_PORT)"
fi

# ── frontend/.env.local ─────────────────────────────────────────────────────
FE_ENV="$WORKTREE_ROOT/frontend/.env.local"
if [[ -f "$FE_ENV" && "$FORCE_ENV" != true ]]; then
  echo "[skip] frontend/.env.local already exists (use --force to overwrite)"
else
  cat > "$FE_ENV" <<EOF
# worktree-local — generated by scripts/setup-worktree.sh
VITE_API_URL=http://localhost:$BACKEND_PORT
VITE_SITE_URL=http://localhost:$FRONTEND_PORT
EOF
  echo "[write] frontend/.env.local"
fi

# ── .claude/launch.json ─────────────────────────────────────────────────────
LAUNCH="$WORKTREE_ROOT/.claude/launch.json"
mkdir -p "$(dirname "$LAUNCH")"
cat > "$LAUNCH" <<EOF
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "frontend",
      "runtimeExecutable": "./dev",
      "runtimeArgs": [],
      "port": $FRONTEND_PORT
    }
  ]
}
EOF
echo "[write] .claude/launch.json"

# ── backend/storage symlink ─────────────────────────────────────────────────
STORAGE_LINK="$WORKTREE_ROOT/backend/storage"
STORAGE_TARGET="$MAIN_ROOT/backend/storage"
if [[ ! -d "$STORAGE_TARGET" ]]; then
  echo "[warn] main storage dir does not exist at $STORAGE_TARGET — skipping symlink"
elif [[ -L "$STORAGE_LINK" ]]; then
  if [[ "$(readlink "$STORAGE_LINK")" == "$STORAGE_TARGET" ]]; then
    echo "[skip] backend/storage symlink already points at main"
  else
    rm "$STORAGE_LINK"
    ln -s "$STORAGE_TARGET" "$STORAGE_LINK"
    echo "[write] backend/storage -> $STORAGE_TARGET (replaced)"
  fi
elif [[ -e "$STORAGE_LINK" ]]; then
  echo "[warn] backend/storage exists and is not a symlink — leaving alone"
else
  ln -s "$STORAGE_TARGET" "$STORAGE_LINK"
  echo "[write] backend/storage -> $STORAGE_TARGET"
fi

# ── worktree-local exclude for the symlink ──────────────────────────────────
# storage/ (trailing slash) in backend/.gitignore doesn't catch symlinks, so
# add an explicit rule in the worktree's local exclude. Prevents `git add -A`
# from staging a machine-specific absolute path.
GIT_DIR=$(git rev-parse --git-dir)
EXCLUDE_FILE="$GIT_DIR/info/exclude"
mkdir -p "$(dirname "$EXCLUDE_FILE")"
if ! grep -qE "^backend/storage$" "$EXCLUDE_FILE" 2>/dev/null; then
  printf '\n# added by scripts/setup-worktree.sh — symlink is machine-specific\nbackend/storage\n' >> "$EXCLUDE_FILE"
  echo "[write] .git/info/exclude (backend/storage)"
fi

# ── npm install ─────────────────────────────────────────────────────────────
if [[ ! -d "$WORKTREE_ROOT/backend/node_modules" ]]; then
  echo "[run]   backend npm install"
  (cd "$WORKTREE_ROOT/backend" && npm install --silent)
else
  echo "[skip] backend/node_modules already present"
fi

if [[ ! -d "$WORKTREE_ROOT/frontend/node_modules" ]]; then
  echo "[run]   frontend npm install"
  (cd "$WORKTREE_ROOT/frontend" && npm install --silent)
else
  echo "[skip] frontend/node_modules already present"
fi

echo
echo "done. in Claude Code, run:"
echo "  preview_start backend"
echo "  preview_start frontend"
