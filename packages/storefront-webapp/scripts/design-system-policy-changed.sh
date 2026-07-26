#!/usr/bin/env bash

set -euo pipefail

PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(git -C "$PACKAGE_ROOT" rev-parse --show-toplevel)"

resolve_base_ref() {
  local candidate

  for candidate in \
    "${DESIGN_SYSTEM_POLICY_BASE_REF:-origin/main}" \
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
  echo "Unable to resolve a base ref for storefront design-system policy." >&2
  echo "Set DESIGN_SYSTEM_POLICY_BASE_REF or fetch origin/main." >&2
  exit 1
fi

MERGE_BASE="$(git -C "$REPO_ROOT" merge-base HEAD "$BASE_REF")"

collect_changed_storefront_files() {
  {
    git -C "$REPO_ROOT" diff --name-only --diff-filter=ACMR "$MERGE_BASE"...HEAD -- \
      packages/storefront-webapp/src
    git -C "$REPO_ROOT" diff --name-only --diff-filter=ACMR -- \
      packages/storefront-webapp/src
    git -C "$REPO_ROOT" diff --cached --name-only --diff-filter=ACMR -- \
      packages/storefront-webapp/src
    git -C "$REPO_ROOT" ls-files --others --exclude-standard -- \
      packages/storefront-webapp/src
  } | sort -u
}

changed_files=()
while IFS= read -r file; do
  if [ ! -f "$REPO_ROOT/$file" ]; then
    continue
  fi

  case "$file" in
    packages/storefront-webapp/src/routeTree.gen.ts | \
    packages/storefront-webapp/**/*.d.ts)
      continue
      ;;
  esac

  changed_files+=("${file#packages/storefront-webapp/}")
done < <(collect_changed_storefront_files | grep -E '\.(css|ts|tsx)$' || true)

if [ "${#changed_files[@]}" -eq 0 ]; then
  echo "No changed storefront design-system files to inspect against $BASE_REF."
  exit 0
fi

echo "Checking changed storefront design-system files against $BASE_REF"
printf ' - %s\n' "${changed_files[@]}"

cd "$PACKAGE_ROOT"
bun scripts/design-system-policy.ts --base "$MERGE_BASE" "${changed_files[@]}"
