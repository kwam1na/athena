#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[symphony-hook before_remove] %s\n' "$*" >&2
}

if [[ -z "${ATHENA_REPO_ROOT:-}" ]]; then
  log 'ATHENA_REPO_ROOT is not set; skipping worktree cleanup'
  exit 0
fi

REPO_ROOT="$(cd "$ATHENA_REPO_ROOT" && pwd)"
WORKSPACE_PATH="$(pwd)"

if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "ATHENA_REPO_ROOT is not a git repository; skipping cleanup: $REPO_ROOT"
  exit 0
fi

log "removing worktree metadata for $WORKSPACE_PATH"
git -C "$REPO_ROOT" worktree remove --force "$WORKSPACE_PATH" >/dev/null 2>&1 || true

log 'pruning stale worktree metadata'
git -C "$REPO_ROOT" worktree prune >/dev/null 2>&1 || true
