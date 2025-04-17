#!/bin/bash

# Prompt to choose app
APP=$(printf "athena-webapp\nstorefront" | fzf --prompt="Select app to rollback: ")

if [ -z "$APP" ]; then
  echo "No app selected. Aborting."
  exit 1
fi

VERSIONS_DIR="/home/ec2-user/athena/$APP/versions"
SYMLINK_PATH="/home/ec2-user/athena/$APP/current"
KEY_PATH="/Users/kwamina/Desktop/athena-webserver/athena-eu-west-key.pem"
REMOTE="ec2-user@ec2-34-244-249-177.eu-west-1.compute.amazonaws.com"

# Check for fzf
if ! command -v fzf &> /dev/null; then
  echo "fzf not found. Install it with: sudo apt install fzf (or brew install fzf on macOS)"
  exit 1
fi

echo "Fetching available versions for $APP..."
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
