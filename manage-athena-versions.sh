#!/bin/bash

# =============================================
# Configuration and Setup
# =============================================

# Check for required dependencies
if ! command -v fzf &> /dev/null; then
  echo "fzf not found. Install it with: sudo apt install fzf (or brew install fzf on macOS)"
  exit 1
fi

# Remote server configuration
REMOTE_USER="root"
REMOTE_HOST="178.128.161.200"
REMOTE="$REMOTE_USER@$REMOTE_HOST"

# Local paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_VPS_SCRIPT="$SCRIPT_DIR/scripts/deploy-vps.sh"

resolve_repo_root() {
  if [ -n "$ATHENA_REPO_ROOT" ]; then
    cd "$ATHENA_REPO_ROOT" 2>/dev/null && pwd
    return
  fi

  if command -v git &> /dev/null; then
    local cwd_root
    cwd_root=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || true)
    if [ -n "$cwd_root" ] && [ -d "$cwd_root/packages/athena-webapp" ]; then
      echo "$cwd_root"
      return
    fi
  fi

  echo "$SCRIPT_DIR"
}

REPO_ROOT="$(resolve_repo_root)"
# =============================================
# Helper Functions
# =============================================

# Get current version info for an app
get_current_version_info() {
  local app="$1"
  local versions_dir="/root/athena/$app/versions"
  local symlink_path="/root/athena/$app/current"
  
  local current_version=$(ssh "$REMOTE" "readlink $symlink_path | xargs basename")
  local fun_name=$(ssh "$REMOTE" "if [ -f $versions_dir/$current_version/fun-name.txt ]; then cat $versions_dir/$current_version/fun-name.txt; fi")
  
  if [ -n "$fun_name" ]; then
    echo "$app: $fun_name ($current_version)"
  else
    echo "$app: $current_version"
  fi
}

# Show current versions of all apps
show_current_versions() {
  echo "Current versions:"
  echo "----------------"
  get_current_version_info "athena-webapp"
  get_current_version_info "storefront"
}

# Get list of versions with their fun names if available
get_version_list_with_fun_names() {
  local versions_dir="$VERSIONS_DIR"
  ssh "$REMOTE" '
    for d in $(ls -1 '"$versions_dir"' | sort -r); do
      fun_name_file="'"$versions_dir"'/$d/fun-name.txt"
      if [ -f "$fun_name_file" ]; then
        name=$(cat "$fun_name_file")
        echo "$name ($d)"
      else
        echo "$d"
      fi
    done
  '
}

# Get fun name for a specific version
get_fun_name() {
  local version="$1"
  ssh "$REMOTE" "
    if [ -f $VERSIONS_DIR/$version/fun-name.txt ]; then
      cat $VERSIONS_DIR/$version/fun-name.txt
    fi
  "
}

# Extract version number from string (handles both plain version and "fun name (version)" format)
extract_version() {
  local input="$1"
  if [[ "$input" =~ .*\((.*)\).* ]]; then
    echo "${BASH_REMATCH[1]}"
  else
    echo "$input"
  fi
}

# =============================================
# Deployment Functions
# =============================================

deploy_vps() {
  if [ ! -x "$DEPLOY_VPS_SCRIPT" ]; then
    echo "Error: authoritative deploy script not found or not executable at $DEPLOY_VPS_SCRIPT"
    return 1
  fi

  "$DEPLOY_VPS_SCRIPT" "$@"
}

# =============================================
# Main Script
# =============================================

# Select operation (rollback, delete versions, deploy, or show versions)
OPERATION=$(printf "rollback\ndelete versions\ndeploy\nshow versions" | fzf --prompt="Select operation: ")
if [ -z "$OPERATION" ]; then
  echo "No operation selected. Aborting."
  exit 1
fi

# Handle show versions operation
if [ "$OPERATION" = "show versions" ]; then
  show_current_versions
  exit 0
fi

# Handle deployment operations
if [ "$OPERATION" = "deploy" ]; then
  # Select app to deploy
  APP=$(printf "athena-webapp\nathena-webapp local build\nstorefront\nstorefront local build\nconvex\nfull-deploy\nfull-deploy local builds\nvalkey-proxy\nqa\nall" | fzf --prompt="Select app to deploy: ")
  if [ -z "$APP" ]; then
    echo "No app selected. Aborting."
    exit 1
  fi

  case "$APP" in
    "athena-webapp")
      deploy_vps athena
      ;;
    "athena-webapp local build")
      deploy_vps athena-local
      ;;
    "storefront")
      deploy_vps storefront
      ;;
    "storefront local build")
      deploy_vps storefront-local
      ;;
    "convex")
      deploy_vps convex-prod
      ;;
    "full-deploy")
      deploy_vps full-prod
      ;;
    "full-deploy local builds")
      deploy_vps full-prod-local
      ;;
    "valkey-proxy")
      deploy_vps valkey-proxy
      ;;
    "qa")
      deploy_vps qa
      ;;
    "all")
      deploy_vps all
      ;;
  esac
  exit 0
fi

# Select app (athena-webapp or storefront)
APP=$(printf "athena-webapp\nstorefront" | fzf --prompt="Select app: ")
if [ -z "$APP" ]; then
  echo "No app selected. Aborting."
  exit 1
fi

# Set up paths
VERSIONS_DIR="/root/athena/$APP/versions"
SYMLINK_PATH="/root/athena/$APP/current"

echo "Fetching available versions for $APP..."

# =============================================
# Rollback Operation
# =============================================
if [ "$OPERATION" = "rollback" ]; then
  # Get list of versions and let user select one
  VERSION_LIST=$(get_version_list_with_fun_names)
  SELECTED=$(printf "%s\n" "$VERSION_LIST" | fzf --prompt="Select version to rollback to: ")
  SELECTED_VERSION=$(extract_version "$SELECTED")

  if [ -z "$SELECTED_VERSION" ]; then
    echo "No version selected. Aborting."
    exit 1
  fi

  # Get current version info
  CURRENT_VERSION=$(ssh "$REMOTE" "readlink $SYMLINK_PATH | xargs basename")
  CURRENT_FUN_NAME=$(get_fun_name "$CURRENT_VERSION")
  
  echo "Rolling back $APP from version $CURRENT_VERSION${CURRENT_FUN_NAME:+ ($CURRENT_FUN_NAME)} to version $SELECTED_VERSION..."

  # Perform rollback through the authoritative deploy script.
  deploy_vps rollback "$APP" "$SELECTED_VERSION"

  # Get selected version's fun name for success message
  SELECTED_FUN_NAME=$(get_fun_name "$SELECTED_VERSION")
  echo -e "✅ Rolled back $APP to version: $SELECTED_VERSION${SELECTED_FUN_NAME:+ ($SELECTED_FUN_NAME)}"

# =============================================
# Delete Versions Operation
# =============================================
else
  # Get current version info
  CURRENT_VERSION=$(ssh "$REMOTE" "readlink $SYMLINK_PATH | xargs basename")
  CURRENT_FUN_NAME=$(get_fun_name "$CURRENT_VERSION")
  
  echo "Current version: $CURRENT_VERSION${CURRENT_FUN_NAME:+ ($CURRENT_FUN_NAME)} (will be protected from deletion)"
  
  # Get list of versions and let user select multiple
  VERSION_LIST=$(get_version_list_with_fun_names)
  SELECTED=$(printf "%s\n" "$VERSION_LIST" | \
    fzf --prompt="Select versions to delete (TAB to multi-select, ESC to confirm): " \
    --multi)

  if [ -z "$SELECTED" ]; then
    echo "No versions selected. Aborting."
    exit 1
  fi

  # Convert selected versions to array
  IFS=$'\n' read -r -d '' -a VERSIONS <<< "$SELECTED"
  
  echo "The following versions will be deleted:"
  for version in "${VERSIONS[@]}"; do
    version_id=$(extract_version "$version")
    if [ "$version_id" = "$CURRENT_VERSION" ]; then
      echo "⚠️  $version_id (current version - will be skipped)"
    else
      echo "🗑️  $version_id"
    fi
  done
  
  # Confirm deletion
  read -p "Are you sure you want to proceed? (y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    for version in "${VERSIONS[@]}"; do
      version_id=$(extract_version "$version")
      if [ "$version_id" != "$CURRENT_VERSION" ]; then
        echo "Deleting version $version_id..."
        ssh "$REMOTE" "rm -rf $VERSIONS_DIR/$version_id"
      fi
    done
    echo -e "✅ Deleted selected versions"
  else
    echo "Operation cancelled."
    exit 1
  fi
fi
