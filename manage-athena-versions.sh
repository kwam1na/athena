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
REMOTE_USER="ec2-user"
REMOTE_HOST="ec2-34-244-249-177.eu-west-1.compute.amazonaws.com"
REMOTE="$REMOTE_USER@$REMOTE_HOST"
KEY_PATH="/Users/kwamina/Desktop/athena-webserver/athena-eu-west-key.pem"

# Local paths
ATHENA_WEBAPP_DIR="$HOME/athena/packages/athena-webapp"
STOREFRONT_DIR="$HOME/athena/packages/storefront-webapp"
VALKEY_PROXY_DIR="$HOME/athena/packages/valkey-proxy-server"

# =============================================
# Helper Functions
# =============================================

# Get current version info for an app
get_current_version_info() {
  local app="$1"
  local versions_dir="/home/ec2-user/athena/$app/versions"
  local symlink_path="/home/ec2-user/athena/$app/current"
  
  local current_version=$(ssh -i "$KEY_PATH" "$REMOTE" "readlink $symlink_path | xargs basename")
  local fun_name=$(ssh -i "$KEY_PATH" "$REMOTE" "if [ -f $versions_dir/$current_version/fun-name.txt ]; then cat $versions_dir/$current_version/fun-name.txt; fi")
  
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
  ssh -i "$KEY_PATH" "$REMOTE" '
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
  ssh -i "$KEY_PATH" "$REMOTE" "
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

# Generate a random fun name for deployments
generate_fun_name() {
  local adjectives=(brave clever happy quick silent wild gentle proud tiny wise)
  local nouns=(tiger eagle panda fox whale lion wolf bear owl dolphin)
  local verbs=(jumps runs flies swims roars climbs glides prowls soars dashes)
  local adj=${adjectives[$RANDOM % ${#adjectives[@]}]}
  local noun=${nouns[$RANDOM % ${#nouns[@]}]}
  local verb=${verbs[$RANDOM % ${#verbs[@]}]}
  echo "$adj-$noun-$verb"
}

# Deploy a specific app
deploy_app() {
  local app_name="$1"
  local app_dir="$2"
  local env_vars="$3"
  
  echo "Building and deploying $app_name..."
  
  # Generate deployment info
  local timestamp=$(date +%Y%m%d%H%M%S)
  local fun_name=$(generate_fun_name)
  local version_path="/home/ec2-user/athena/$app_name/versions/$timestamp"
  local symlink_path="/home/ec2-user/athena/$app_name/current"
  
  # Build the app
  echo "Building $app_name..."
  cd "$app_dir" || { echo "Failed to change to $app_dir"; return 1; }
  eval "$env_vars bun run build" || { echo "Build failed"; return 1; }
  
  # Deploy to server
  echo "Deploying to server..."
  ssh -i "$KEY_PATH" "$REMOTE" "mkdir -p $version_path && echo '$fun_name' > $version_path/fun-name.txt" || return 1
  scp -i "$KEY_PATH" -r dist/* "$REMOTE:$version_path" || return 1
  ssh -i "$KEY_PATH" "$REMOTE" "ln -sfn $version_path $symlink_path" || return 1
  
  echo "✅ Deployed $app_name version: $fun_name ($timestamp)"
}

# Copy valkey proxy server to EC2 instance
copy_valkey_proxy() {
  echo "Deploying valkey-proxy-server to EC2 instance..."
  
  if [ ! -d "$VALKEY_PROXY_DIR" ]; then
    echo "Error: valkey-proxy-server directory not found at $VALKEY_PROXY_DIR"
    return 1
  fi
  
  scp -i "$KEY_PATH" -r "$VALKEY_PROXY_DIR" "$REMOTE:/home/ec2-user/"
  
  if [ $? -eq 0 ]; then
    echo "✅ Successfully deployed valkey-proxy-server to EC2 instance"
  else
    echo "❌ Failed to deploy valkey-proxy-server to EC2 instance"
    return 1
  fi
}

# =============================================
# Deployment Functions
# =============================================

deploy_convex() {
  echo "Deploying Convex backend..."
  npx convex deploy || { echo "Convex deployment failed"; return 1; }
  echo "✅ Convex backend deployed successfully"
}

deploy_athena() {
  local env_vars="VITE_CONVEX_URL=https://colorless-cardinal-870.convex.cloud \
    VITE_API_GATEWAY_URL='https://colorless-cardinal-870.convex.site' \
    VITE_HLS_URL='https://d1sjmzps5tlpbc.cloudfront.net' \
    VITE_STOREFRONT_URL='https://wigclub.store'"
  deploy_app "athena-webapp" "$ATHENA_WEBAPP_DIR" "$env_vars"
}

deploy_storefront() {
  local env_vars="VITE_API_URL='https://api.wigclub.store' \
    VITE_HLS_URL='https://d1sjmzps5tlpbc.cloudfront.net'"
  deploy_app "storefront" "$STOREFRONT_DIR" "$env_vars"
}

full_deploy_athena() {
  deploy_convex || return 1
  deploy_athena
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
  APP=$(printf "athena-webapp\nstorefront\nconvex\nfull-deploy\nvalkey-proxy" | fzf --prompt="Select app to deploy: ")
  if [ -z "$APP" ]; then
    echo "No app selected. Aborting."
    exit 1
  fi

  case "$APP" in
    "athena-webapp")
      deploy_athena
      ;;
    "storefront")
      deploy_storefront
      ;;
    "convex")
      deploy_convex
      ;;
    "full-deploy")
      full_deploy_athena
      ;;
    "valkey-proxy")
      copy_valkey_proxy
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
VERSIONS_DIR="/home/ec2-user/athena/$APP/versions"
SYMLINK_PATH="/home/ec2-user/athena/$APP/current"

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
  CURRENT_VERSION=$(ssh -i "$KEY_PATH" "$REMOTE" "readlink $SYMLINK_PATH | xargs basename")
  CURRENT_FUN_NAME=$(get_fun_name "$CURRENT_VERSION")
  
  echo "Rolling back $APP from version $CURRENT_VERSION${CURRENT_FUN_NAME:+ ($CURRENT_FUN_NAME)} to version $SELECTED_VERSION..."

  # Perform rollback
  ssh -i "$KEY_PATH" "$REMOTE" "ln -sfn $VERSIONS_DIR/$SELECTED_VERSION $SYMLINK_PATH"

  # Get selected version's fun name for success message
  SELECTED_FUN_NAME=$(get_fun_name "$SELECTED_VERSION")
  echo -e "✅ Rolled back $APP to version: $SELECTED_VERSION${SELECTED_FUN_NAME:+ ($SELECTED_FUN_NAME)}"

# =============================================
# Delete Versions Operation
# =============================================
else
  # Get current version info
  CURRENT_VERSION=$(ssh -i "$KEY_PATH" "$REMOTE" "readlink $SYMLINK_PATH | xargs basename")
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
        ssh -i "$KEY_PATH" "$REMOTE" "rm -rf $VERSIONS_DIR/$version_id"
      fi
    done
    echo -e "✅ Deleted selected versions"
  else
    echo "Operation cancelled."
    exit 1
  fi
fi
