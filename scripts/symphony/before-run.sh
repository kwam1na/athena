#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[symphony-hook before_run] %s\n' "$*" >&2
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

if ! git -C "$WORKSPACE_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "workspace is not git-backed: $WORKSPACE_PATH"
  exit 1
fi

ISSUE_KEY="$(basename "$WORKSPACE_PATH")"
BRANCH_SUFFIX="$(printf '%s' "$ISSUE_KEY" | sed -E 's/[^A-Za-z0-9._-]+/-/g')"
BRANCH_SUFFIX="${BRANCH_SUFFIX#-}"
BRANCH_SUFFIX="${BRANCH_SUFFIX%-}"
if [[ -z "$BRANCH_SUFFIX" ]]; then
  BRANCH_SUFFIX='issue'
fi
BRANCH_NAME="codex/$BRANCH_SUFFIX"

CURRENT_BRANCH="$(git -C "$WORKSPACE_PATH" rev-parse --abbrev-ref HEAD || echo '')"
if [[ "$CURRENT_BRANCH" != "$BRANCH_NAME" ]]; then
  if git -C "$WORKSPACE_PATH" show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    log "switching to existing branch $BRANCH_NAME"
    git -C "$WORKSPACE_PATH" checkout "$BRANCH_NAME"
  else
    log "creating missing branch $BRANCH_NAME"
    git -C "$WORKSPACE_PATH" checkout -b "$BRANCH_NAME"
  fi
fi

if [[ ! -d "$WORKSPACE_PATH/node_modules" ]]; then
  log 'node_modules missing; running bun install'
  (cd "$WORKSPACE_PATH" && bun install)
else
  log 'node_modules present; skipping bun install'
fi
