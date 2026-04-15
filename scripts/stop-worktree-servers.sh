#!/usr/bin/env bash
#
# stop-worktree-servers.sh — kill whatever is listening on this worktree's
# frontend/backend ports. Reads the ports from .claude/launch.json so it
# only ever targets this worktree's own servers.
#
# Use when: Claude Code crashed and left dev servers orphaned, or you just
# want a clean slate without touching the main worktree's servers.

set -euo pipefail

WORKTREE_ROOT=$(git rev-parse --show-toplevel)
LAUNCH="$WORKTREE_ROOT/.claude/launch.json"

if [[ ! -f "$LAUNCH" ]]; then
  echo "error: no .claude/launch.json in $WORKTREE_ROOT"
  echo "run scripts/setup-worktree.sh first."
  exit 1
fi

# grep out every "port": N line from launch.json
PORTS=$(grep -oE '"port"[[:space:]]*:[[:space:]]*[0-9]+' "$LAUNCH" | grep -oE '[0-9]+' | sort -u)

if [[ -z "$PORTS" ]]; then
  echo "no ports found in launch.json"
  exit 0
fi

for port in $PORTS; do
  pid=$(lsof -ti ":$port" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -z "$pid" ]]; then
    echo "[skip] port $port: nothing listening"
    continue
  fi
  echo "[kill] port $port: pid $pid"
  kill "$pid" 2>/dev/null || true
  sleep 0.2
  # if still alive, force
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
    echo "       forced (SIGKILL)"
  fi
done
