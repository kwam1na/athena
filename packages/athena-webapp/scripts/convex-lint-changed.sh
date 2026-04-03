#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(git -C "$ROOT_DIR" rev-parse --show-toplevel)"

resolve_base_ref() {
  local candidate

  for candidate in \
    "${CONVEX_LINT_BASE_REF:-origin/main}" \
    "origin/main" \
    "main"
  do
    if git -C "$REPO_ROOT" rev-parse --verify "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

if ! BASE_REF="$(resolve_base_ref)"; then
  echo "Unable to resolve a base ref for Convex changed-file linting." >&2
  echo "Set CONVEX_LINT_BASE_REF or fetch origin/main before running this script." >&2
  exit 1
fi

MERGE_BASE="$(git -C "$REPO_ROOT" merge-base HEAD "$BASE_REF")"

changed_files=()

while IFS= read -r file; do
  changed_files+=("${file#packages/athena-webapp/}")
done < <(
  git -C "$REPO_ROOT" diff --name-only --diff-filter=ACMR "$MERGE_BASE"...HEAD -- packages/athena-webapp/convex \
    | grep -E '\.ts$' || true
)

if [ "${#changed_files[@]}" -eq 0 ]; then
  echo "No changed Convex files to lint against $BASE_REF."
  exit 0
fi

echo "Linting changed Convex files against $BASE_REF"
printf ' - %s\n' "${changed_files[@]}"

cd "$ROOT_DIR"
eslint "${changed_files[@]}"
