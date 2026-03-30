#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[symphony-hook after_create] %s\n' "$*" >&2
}

if [[ -z "${ATHENA_REPO_ROOT:-}" ]]; then
  log 'ATHENA_REPO_ROOT is required'
  exit 1
fi

REPO_ROOT="$(cd "$ATHENA_REPO_ROOT" && pwd)"
WORKSPACE_PATH="$(pwd)"

if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "ATHENA_REPO_ROOT is not a git repository: $REPO_ROOT"
  exit 1
fi

if git -C "$WORKSPACE_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "workspace already git-backed: $WORKSPACE_PATH"
else
  log "fetching origin/main in $REPO_ROOT"
  git -C "$REPO_ROOT" fetch origin main --prune

  log "adding git worktree at $WORKSPACE_PATH from origin/main"
  git -C "$REPO_ROOT" worktree add --detach "$WORKSPACE_PATH" origin/main
fi

ISSUE_KEY="$(basename "$WORKSPACE_PATH")"
BRANCH_SUFFIX="$(printf '%s' "$ISSUE_KEY" | sed -E 's/[^A-Za-z0-9._-]+/-/g')"
BRANCH_SUFFIX="${BRANCH_SUFFIX#-}"
BRANCH_SUFFIX="${BRANCH_SUFFIX%-}"
if [[ -z "$BRANCH_SUFFIX" ]]; then
  BRANCH_SUFFIX='issue'
fi
BRANCH_NAME="codex/$BRANCH_SUFFIX"

if git -C "$WORKSPACE_PATH" show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  log "checking out existing local branch $BRANCH_NAME"
  git -C "$WORKSPACE_PATH" checkout "$BRANCH_NAME"
  exit 0
fi

if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  log "checking out existing repo branch $BRANCH_NAME"
  git -C "$WORKSPACE_PATH" checkout "$BRANCH_NAME"
  exit 0
fi

log "creating branch $BRANCH_NAME"
git -C "$WORKSPACE_PATH" checkout -b "$BRANCH_NAME"
