#!/bin/bash
#
# Create a new git worktree with environment files and dev-tool trust.
#
# The distinctive work this script does (vs. raw `git worktree add`):
#   1. Copies .env* files from the main repo (skipping .env.example)
#   2. Trusts mise/direnv configs with branch-aware safety rules,
#      so hooks and scripts don't block on interactive trust prompts
#   3. Ensures .worktrees is gitignored (via `git check-ignore`)
#   4. Installs Bun dependencies from the lockfile when package manifests exist
#
# List / remove / switch operations are NOT provided here. Use git directly:
#   scripts/worktree-manager.sh setup-env <worktree-path>
#   git worktree list
#   git worktree remove <path>
#   cd <worktree-path>   # switching is just `cd`

set -euo pipefail

# Resolve the main worktree's working tree, not the current worktree's toplevel.
# `git worktree list --porcelain` always emits the main worktree first. This
# handles normal repos, linked worktrees (where --show-toplevel would return
# the nested worktree), submodules (where --git-common-dir points under
# .git/modules), and --separate-git-dir setups (where --git-common-dir points
# to an external path). Parse with `sed` to preserve paths containing spaces
# (awk '{print $2}' would truncate them).
GIT_ROOT=$(git worktree list --porcelain | sed -n 's/^worktree //p' | head -n 1)
WORKTREE_DIR="$GIT_ROOT/.worktrees"

usage() {
  cat <<'EOF'
Usage:
  worktree-manager.sh create <branch-name> [from-branch]
  worktree-manager.sh setup-env <worktree-path>

Creates .worktrees/<branch-name> with <branch-name> branched from
[from-branch] (default: origin's default branch, or main).

setup-env copies missing local env files into an existing worktree without
overwriting existing destination files, then installs package dependencies when
package.json and bun.lockb are present.

The main repo checkout is not modified; from-branch is fetched but
not checked out.

Protected branch names such as main, master, develop, dev, trunk,
staging, and release/* are rejected as worktree branch names.
EOF
}

# Ensure .worktrees is ignored in the main repo. Runs `git check-ignore` from
# the main repo root so it sees the main repo's .gitignore (which is not
# inherited by linked worktrees). Falls back to a grep guard to avoid
# duplicate entries when check-ignore misses an uncommitted gitignore rule.
ensure_gitignore() {
  if (cd "$GIT_ROOT" && git check-ignore -q .worktrees) 2>/dev/null; then
    return
  fi
  if grep -Fxq ".worktrees" "$GIT_ROOT/.gitignore" 2>/dev/null; then
    return
  fi
  echo ".worktrees" >> "$GIT_ROOT/.gitignore"
  echo "Added .worktrees to .gitignore"
}

ATHENA_WEBAPP_ENV_DIR="packages/athena-webapp"

has_env_files_in_dir() {
  local relative_dir="$1"
  local source_dir="$GIT_ROOT"
  if [[ -n "$relative_dir" ]]; then
    source_dir="$GIT_ROOT/$relative_dir"
  fi

  shopt -s nullglob
  for source in "$source_dir"/.env*; do
    [[ -f "$source" ]] || continue
    [[ "$(basename "$source")" == ".env.example" ]] && continue
    shopt -u nullglob
    return 0
  done
  shopt -u nullglob
  return 1
}

require_env_files_available() {
  local relative_dir="$1" label="$2"
  local source_dir="$GIT_ROOT/$relative_dir"
  if has_env_files_in_dir "$relative_dir"; then
    return
  fi

  echo "Error: Missing $label env files." >&2
  echo "Expected at least one local file matching $source_dir/.env* (excluding .env.example)." >&2
  echo "Create or copy $relative_dir/.env with CONVEX_DEPLOYMENT and VITE_CONVEX_URL before creating agent worktrees." >&2
  exit 1
}

# Copy .env* files (except .env.example) from a repo-relative directory into
# the worktree. Existing destination files are preserved so rerunning setup
# does not clobber local overrides.
copy_env_files_from_dir() {
  local worktree_path="$1" relative_dir="$2" label="$3" required="$4"
  local copied=0
  local kept=0
  local source_dir="$GIT_ROOT"
  if [[ -n "$relative_dir" ]]; then
    source_dir="$GIT_ROOT/$relative_dir"
  fi

  shopt -s nullglob
  for source in "$source_dir"/.env*; do
    [[ -f "$source" ]] || continue
    local name
    name=$(basename "$source")
    [[ "$name" == ".env.example" ]] && continue

    local dest_dir="$worktree_path"
    if [[ -n "$relative_dir" ]]; then
      dest_dir="$worktree_path/$relative_dir"
    fi
    mkdir -p "$dest_dir"
    local dest="$dest_dir/$name"
    if [[ -f "$dest" ]]; then
      echo "  Kept existing ${relative_dir:+$relative_dir/}$name"
      kept=$((kept + 1))
      continue
    fi
    cp "$source" "$dest"
    echo "  Copied ${relative_dir:+$relative_dir/}$name"
    copied=$((copied + 1))
  done
  shopt -u nullglob

  if [[ $copied -eq 0 && $kept -eq 0 ]]; then
    if [[ "$required" == "true" ]]; then
      require_env_files_available "$relative_dir" "$label"
    fi
    echo "  No $label .env files"
  fi
}

copy_env_files() {
  local worktree_path="$1"
  copy_env_files_from_dir "$worktree_path" "" "repo root" "false"
  copy_env_files_from_dir "$worktree_path" "$ATHENA_WEBAPP_ENV_DIR" "Athena webapp" "true"
}

install_worktree_dependencies() {
  local worktree_path="$1"

  if [[ ! -f "$worktree_path/package.json" || ! -f "$worktree_path/bun.lockb" ]]; then
    echo "Dependencies:"
    echo "  Skipped: package.json and bun.lockb not both present"
    return
  fi

  if ! command -v bun &>/dev/null; then
    echo "Error: bun is required to install worktree dependencies." >&2
    exit 1
  fi

  echo "Dependencies:"
  (cd "$worktree_path" && bun install --frozen-lockfile)
}

get_default_branch() {
  local head_ref
  head_ref=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || true)
  if [[ -n "$head_ref" ]]; then
    echo "${head_ref#refs/remotes/origin/}"
  else
    echo "main"
  fi
}

# Auto-trust is only safe when the worktree is based on a long-lived branch
# the developer already controls. Review/PR branches fall back to the default
# branch baseline and require manual direnv approval.
is_trusted_base_branch() {
  local branch="$1"
  local default_branch="$2"
  [[ "$branch" == "$default_branch" ]] && return 0
  case "$branch" in
    develop|dev|trunk|staging|release/*) return 0 ;;
    *) return 1 ;;
  esac
}

is_protected_branch_name() {
  local branch="$1"
  case "$branch" in
    main|master|develop|dev|trunk|staging|release/*) return 0 ;;
    *) return 1 ;;
  esac
}

# Return 0 if worktree's copy of $file has the same blob hash as $base_ref's.
# Symlinks are rejected (can't verify content).
config_unchanged() {
  local file="$1" base_ref="$2" worktree_path="$3"
  [[ -L "$worktree_path/$file" ]] && return 1
  local base_hash worktree_hash
  base_hash=$(git rev-parse "$base_ref:$file" 2>/dev/null) || return 1
  worktree_hash=$(git hash-object "$worktree_path/$file") || return 1
  [[ "$base_hash" == "$worktree_hash" ]]
}

# Trust dev tool configs (mise, direnv) so hooks/scripts don't block on
# interactive trust prompts. Auto-trusts only when the config matches the
# trusted baseline branch.
trust_dev_tools() {
  local worktree_path="$1" base_ref="$2" allow_direnv_auto="$3"
  local trusted=0
  local manual=()

  if command -v mise &>/dev/null; then
    for f in .mise.toml mise.toml .tool-versions; do
      [[ -f "$worktree_path/$f" ]] || continue
      if config_unchanged "$f" "$base_ref" "$worktree_path" \
         && (cd "$worktree_path" && mise trust "$f" --quiet); then
        trusted=$((trusted + 1))
      else
        manual+=("mise trust $f")
      fi
      break
    done
  fi

  if command -v direnv &>/dev/null && [[ -f "$worktree_path/.envrc" ]]; then
    if [[ "$allow_direnv_auto" == "true" ]] \
       && config_unchanged ".envrc" "$base_ref" "$worktree_path" \
       && (cd "$worktree_path" && direnv allow); then
      trusted=$((trusted + 1))
    else
      manual+=("direnv allow")
    fi
  fi

  [[ $trusted -gt 0 ]] && echo "  Trusted $trusted dev tool config(s)"
  if [[ ${#manual[@]} -gt 0 ]]; then
    echo "  Manual review required for: ${manual[*]}"
    echo "  Review the diff, then run from $worktree_path"
  fi
}

create_worktree() {
  local branch_name="${1:-}"
  local from_branch="${2:-}"

  if [[ -z "$branch_name" ]]; then
    echo "Error: branch name required" >&2
    usage >&2
    exit 1
  fi
  if is_protected_branch_name "$branch_name"; then
    echo "Error: refusing to create a linked worktree on protected branch '$branch_name'" >&2
    echo "Create a feature branch instead, for example 'codex/<ticket-id>' or 'feat/<name>'." >&2
    exit 1
  fi

  local default_branch
  default_branch=$(get_default_branch)
  from_branch="${from_branch:-$default_branch}"

  local worktree_path="$WORKTREE_DIR/$branch_name"
  if [[ -d "$worktree_path" ]]; then
    echo "Error: worktree already exists at $worktree_path" >&2
    echo "Use 'cd $worktree_path' to switch, or 'git worktree remove' first." >&2
    exit 1
  fi
  require_env_files_available "$ATHENA_WEBAPP_ENV_DIR" "Athena webapp"

  echo "Creating worktree $branch_name from $from_branch"

  mkdir -p "$WORKTREE_DIR"
  ensure_gitignore

  # Fetch from-branch without touching the main checkout.
  if ! git fetch origin "$from_branch" --quiet; then
    echo "Warning: could not fetch origin/$from_branch; using local ref" >&2
  fi

  # Prefer origin/<from> if available, else fall back to local ref.
  local base_ref="origin/$from_branch"
  if ! git rev-parse --verify "$base_ref" &>/dev/null; then
    base_ref="$from_branch"
  fi

  git worktree add -b "$branch_name" "$worktree_path" "$base_ref"

  setup_env "$worktree_path"

  echo "Dev tool trust:"
  local trust_branch="$default_branch"
  local allow_direnv_auto="false"
  if is_trusted_base_branch "$from_branch" "$default_branch"; then
    trust_branch="$from_branch"
    allow_direnv_auto="true"
  fi
  # Refresh the trust baseline before the hash-baseline check. Without this,
  # a stale origin/<default_branch> can cause auto-trust against an outdated
  # baseline when from_branch is untrusted (feature/review branches).
  if [[ "$trust_branch" != "$from_branch" ]]; then
    if ! git fetch origin "$trust_branch" --quiet; then
      echo "  Warning: could not fetch origin/$trust_branch; baseline may be stale" >&2
    fi
  fi
  local trust_ref="origin/$trust_branch"
  if git rev-parse --verify "$trust_ref" &>/dev/null; then
    trust_dev_tools "$worktree_path" "$trust_ref" "$allow_direnv_auto"
  else
    echo "  Skipped: $trust_ref not available locally"
  fi

  echo ""
  echo "Worktree ready: $worktree_path"
  echo "Switch with: cd $worktree_path"
}

setup_env() {
  local worktree_path="${1:-}"
  if [[ -z "$worktree_path" ]]; then
    echo "Error: worktree path required" >&2
    usage >&2
    exit 1
  fi
  if [[ ! -d "$worktree_path" ]]; then
    echo "Error: worktree path does not exist: $worktree_path" >&2
    exit 1
  fi

  echo "Environment files:"
  copy_env_files "$worktree_path"
  install_worktree_dependencies "$worktree_path"
}

main() {
  local command="${1:-}"
  shift || true
  case "$command" in
    create) create_worktree "$@" ;;
    setup-env) setup_env "$@" ;;
    ""|help|-h|--help) usage ;;
    *)
      echo "Error: unknown command '$command'" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
