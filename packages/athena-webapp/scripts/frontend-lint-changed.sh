#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(git -C "$ROOT_DIR" rev-parse --show-toplevel)"

resolve_base_ref() {
  local candidate

  for candidate in \
    "${FRONTEND_LINT_BASE_REF:-origin/main}" \
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
  echo "Unable to resolve a base ref for frontend changed-file linting." >&2
  echo "Set FRONTEND_LINT_BASE_REF or fetch origin/main before running this script." >&2
  exit 1
fi

MERGE_BASE="$(git -C "$REPO_ROOT" merge-base HEAD "$BASE_REF")"

changed_files=()

collect_changed_frontend_files() {
  {
    git -C "$REPO_ROOT" diff --name-only --diff-filter=ACMR "$MERGE_BASE"...HEAD -- \
      packages/athena-webapp/src \
      packages/athena-webapp/shared \
      packages/athena-webapp/types.ts
    git -C "$REPO_ROOT" diff --name-only --diff-filter=ACMR -- \
      packages/athena-webapp/src \
      packages/athena-webapp/shared \
      packages/athena-webapp/types.ts
    git -C "$REPO_ROOT" diff --cached --name-only --diff-filter=ACMR -- \
      packages/athena-webapp/src \
      packages/athena-webapp/shared \
      packages/athena-webapp/types.ts
    git -C "$REPO_ROOT" ls-files --others --exclude-standard -- \
      packages/athena-webapp/src \
      packages/athena-webapp/shared \
      packages/athena-webapp/types.ts
  } | sort -u
}

while IFS= read -r file; do
  case "$file" in
    packages/athena-webapp/src/routeTree.gen.ts | \
    packages/athena-webapp/**/*.d.ts)
      continue
      ;;
  esac

  changed_files+=("${file#packages/athena-webapp/}")
done < <(collect_changed_frontend_files | grep -E '\.(ts|tsx)$' || true)

if [ "${#changed_files[@]}" -eq 0 ]; then
  echo "No changed frontend files to lint against $BASE_REF."
  exit 0
fi

echo "Linting changed frontend files against $BASE_REF"
printf ' - %s\n' "${changed_files[@]}"

cd "$ROOT_DIR"
eslint "${changed_files[@]}"
