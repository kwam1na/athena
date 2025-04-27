#!/bin/bash

# Check for fzf
if ! command -v fzf &> /dev/null; then
  echo "fzf not found. Install it with: sudo apt install fzf (or brew install fzf on macOS)"
  exit 1
fi

# Choose operation
OPERATION=$(printf "rollback\ndelete versions" | fzf --prompt="Select operation: ")

if [ -z "$OPERATION" ]; then
  echo "No operation selected. Aborting."
  exit 1
fi

# Prompt to choose app
APP=$(printf "athena-webapp\nstorefront" | fzf --prompt="Select app: ")

if [ -z "$APP" ]; then
  echo "No app selected. Aborting."
  exit 1
fi

VERSIONS_DIR="/home/ec2-user/athena/$APP/versions"
SYMLINK_PATH="/home/ec2-user/athena/$APP/current"
KEY_PATH="/Users/kwamina/Desktop/athena-webserver/athena-eu-west-key.pem"
REMOTE="ec2-user@ec2-34-244-249-177.eu-west-1.compute.amazonaws.com"

echo "Fetching available versions for $APP..."

if [ "$OPERATION" = "rollback" ]; then
  SELECTED=$(ssh -i "$KEY_PATH" "$REMOTE" \
    "ls -1 $VERSIONS_DIR | sort -r" | fzf --prompt="Select version to rollback to: ")

  if [ -z "$SELECTED" ]; then
    echo "No version selected. Aborting."
    exit 1
  fi

  echo "Rolling back $APP to version $SELECTED..."

  ssh -i "$KEY_PATH" "$REMOTE" \
    "ln -sfn $VERSIONS_DIR/$SELECTED $SYMLINK_PATH"

  echo -e "✅ Rolled back $APP to version: $SELECTED"
else
  # Get current version to prevent its deletion
  CURRENT_VERSION=$(ssh -i "$KEY_PATH" "$REMOTE" \
    "readlink $SYMLINK_PATH | xargs basename")
  
  echo "Current version: $CURRENT_VERSION (will be protected from deletion)"
  
  SELECTED=$(ssh -i "$KEY_PATH" "$REMOTE" \
    "ls -1 $VERSIONS_DIR | sort -r" | \
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
    if [ "$version" = "$CURRENT_VERSION" ]; then
      echo "⚠️  $version (current version - will be skipped)"
    else
      echo "🗑️  $version"
    fi
  done
  
  read -p "Are you sure you want to proceed? (y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    for version in "${VERSIONS[@]}"; do
      if [ "$version" != "$CURRENT_VERSION" ]; then
        echo "Deleting version $version..."
        ssh -i "$KEY_PATH" "$REMOTE" \
          "rm -rf $VERSIONS_DIR/$version"
      fi
    done
    echo -e "✅ Deleted selected versions"
  else
    echo "Operation cancelled."
    exit 1
  fi
fi
