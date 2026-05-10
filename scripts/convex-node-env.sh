#!/usr/bin/env bash

convex_supported_node_major() {
  case "$1" in
    18|20|22|24)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

convex_node_version() {
  local candidate="$1"

  "$candidate" -v 2>/dev/null
}

resolve_convex_node_bin() {
  local candidates=(
    "${ATHENA_CONVEX_NODE_BIN:-}"
    "${NODE_BINARY:-}"
  )

  if [[ -n "${HOME:-}" ]]; then
    candidates+=("$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node")
  fi

  candidates+=(
    "/opt/homebrew/opt/node@24/bin/node"
    "/opt/homebrew/opt/node@22/bin/node"
    "/opt/homebrew/opt/node@20/bin/node"
    "/opt/homebrew/opt/node@18/bin/node"
    "/usr/local/opt/node@24/bin/node"
    "/usr/local/opt/node@22/bin/node"
    "/usr/local/opt/node@20/bin/node"
    "/usr/local/opt/node@18/bin/node"
    "node"
  )

  local seen=":"
  local checked=()
  local candidate
  local resolved
  local version
  local major

  for candidate in "${candidates[@]}"; do
    if [[ -z "$candidate" || "$seen" == *":$candidate:"* ]]; then
      continue
    fi
    seen="$seen$candidate:"

    if [[ "$candidate" == */* ]]; then
      resolved="$candidate"
      [[ -x "$resolved" ]] || continue
    else
      resolved="$(command -v "$candidate" 2>/dev/null || true)"
      [[ -n "$resolved" ]] || continue
    fi

    version="$(convex_node_version "$resolved" || true)"
    [[ -n "$version" ]] || continue
    checked+=("$resolved => $version")

    major="${version#v}"
    major="${major%%.*}"

    if convex_supported_node_major "$major"; then
      printf '%s\n' "$resolved"
      return 0
    fi
  done

  {
    printf 'Convex deploy requires Node.js 18, 20, 22, or 24 because Convex bundles and deploys node actions.\n'
    printf 'Install a supported Node version or set ATHENA_CONVEX_NODE_BIN=/absolute/path/to/node before rerunning.\n'
    if ((${#checked[@]} > 0)); then
      printf 'Checked Node candidates:\n'
      printf '  - %s\n' "${checked[@]}"
    else
      printf 'No Node candidates could be executed.\n'
    fi
  } >&2
  return 1
}

resolve_convex_esbuild_bin() {
  local repo_root="$1"
  local candidates=(
    "${ATHENA_CONVEX_ESBUILD_BIN:-}"
    "${ESBUILD_BINARY_PATH:-}"
  )

  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)
      candidates+=("$repo_root/node_modules/@esbuild/darwin-arm64/bin/esbuild")
      ;;
  esac

  local seen=":"
  local candidate

  for candidate in "${candidates[@]}"; do
    if [[ -z "$candidate" || "$seen" == *":$candidate:"* ]]; then
      continue
    fi
    seen="$seen$candidate:"

    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}
