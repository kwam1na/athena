#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:-root@178.128.161.200}"
REMOTE_REPO="${REMOTE_REPO:-git@github.com:kwam1na/athena.git}"
REMOTE_SOURCE_DIR="${REMOTE_SOURCE_DIR:-/root/athena/repo}"
DEPLOY_REF="${DEPLOY_REF:-origin/main}"
ATHENA_ROOT="${ATHENA_ROOT:-/root/athena}"
ATHENA_QA_PORT="${ATHENA_QA_PORT:-${QA_PORT:-5175}}"
STOREFRONT_QA_PORT="${STOREFRONT_QA_PORT:-5176}"
ATHENA_QA_HOST="${ATHENA_QA_HOST:-${QA_HOST:-athena-qa.wigclub.store}}"
STOREFRONT_QA_HOST="${STOREFRONT_QA_HOST:-qa.wigclub.store}"

PROD_CONVEX_CLOUD="${PROD_CONVEX_CLOUD:-https://colorless-cardinal-870.convex.cloud}"
PROD_CONVEX_SITE="${PROD_CONVEX_SITE:-https://colorless-cardinal-870.convex.site}"
PROD_API_URL="${PROD_API_URL:-https://api.wigclub.store}"
DEV_CONVEX_CLOUD="${DEV_CONVEX_CLOUD:-https://jovial-wildebeest-179.convex.cloud}"
DEV_CONVEX_SITE="${DEV_CONVEX_SITE:-https://jovial-wildebeest-179.convex.site}"
DEV_API_URL="${DEV_API_URL:-https://dev.wigclub.store}"
STOREFRONT_URL="${STOREFRONT_URL:-https://wigclub.store}"

usage() {
  cat <<USAGE
Usage: scripts/deploy-vps.sh <command>

Commands:
  status             Show remote services and active static versions.
  versions <app>     List deployed static versions for athena or storefront.
  athena            Build and deploy the production Athena admin app.
  storefront        Build and deploy the production storefront.
  athena-local      Build the production Athena admin app locally, then upload it.
  storefront-local  Build the production storefront locally, then upload it.
  valkey-proxy      Install and restart the Valkey proxy from the remote checkout.
  qa                Refresh both QA dev servers from the remote checkout.
  qa-athena         Refresh the Athena admin QA dev server.
  qa-storefront     Refresh the storefront QA dev server.
  convex-prod       Deploy Convex from the local checkout.
  full-prod         Deploy Convex, Athena admin, storefront, and Valkey proxy.
  full-prod-local   Deploy Convex, locally built static apps, and Valkey proxy.
  all               Deploy full-prod and refresh QA.
  rollback <app> <version|previous>
                     Roll back athena or storefront to a deployed static version.
  rollback-athena <version|previous>
                     Roll back the production Athena admin app.
  rollback-storefront <version|previous>
                     Roll back the production storefront.
  check-git         Verify that the VPS can reach GitHub over SSH.

Environment:
  REMOTE            SSH target. Default: root@178.128.161.200
  REMOTE_REPO       Git repo URL cloned on the VPS. Default: git@github.com:kwam1na/athena.git
  REMOTE_SOURCE_DIR Shared remote checkout. Default: /root/athena/repo
  DEPLOY_REF        Git ref checked out on the VPS. Default: origin/main
  CONVEX_DEPLOYMENT Production Convex deployment. Defaults to the prod deployment
                    inferred from PROD_CONVEX_CLOUD.
USAGE
}

remote() {
  ssh "$REMOTE" "$@"
}

remote_script() {
  ssh "$REMOTE" "bash -s" -- "$@"
}

normalize_static_app() {
  case "${1:-}" in
    athena|athena-webapp)
      printf '%s\n' "athena-webapp"
      ;;
    storefront|store)
      printf '%s\n' "storefront"
      ;;
    *)
      cat >&2 <<'MESSAGE'
Expected app to be one of: athena, athena-webapp, storefront, store.
MESSAGE
      return 1
      ;;
  esac
}

require_remote_source() {
  remote_script "$REMOTE_REPO" "$REMOTE_SOURCE_DIR" "$DEPLOY_REF" <<'REMOTE_SCRIPT'
set -euo pipefail

REMOTE_REPO="$1"
REMOTE_SOURCE_DIR="$2"
DEPLOY_REF="$3"

export BUN_INSTALL="${BUN_INSTALL:-/root/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

if ! command -v git >/dev/null 2>&1; then
  apt-get update
  apt-get install -y git
fi

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

if [ ! -d "$REMOTE_SOURCE_DIR/.git" ]; then
  rm -rf "$REMOTE_SOURCE_DIR"
  mkdir -p "$(dirname "$REMOTE_SOURCE_DIR")"
  if ! git ls-remote "$REMOTE_REPO" HEAD >/tmp/athena-github-ssh-check.log 2>&1; then
    cat /tmp/athena-github-ssh-check.log >&2
    cat >&2 <<'MESSAGE'

The VPS cannot authenticate to GitHub yet.
Add the VPS SSH public key to GitHub with read access to the Athena repo, then rerun:
  scripts/deploy-vps.sh check-git
MESSAGE
    exit 1
  fi
  git clone "$REMOTE_REPO" "$REMOTE_SOURCE_DIR"
fi

cd "$REMOTE_SOURCE_DIR"
git fetch --prune origin
git checkout --detach "$DEPLOY_REF"
bun install --ignore-scripts
REMOTE_SCRIPT
}

check_git() {
  remote_script "$REMOTE_REPO" <<'REMOTE_SCRIPT'
set -euo pipefail

REMOTE_REPO="$1"

if git ls-remote "$REMOTE_REPO" HEAD >/tmp/athena-github-ssh-check.log 2>&1; then
  printf 'The VPS can read %s over SSH.\n' "$REMOTE_REPO"
  cat /tmp/athena-github-ssh-check.log
  exit 0
fi

cat /tmp/athena-github-ssh-check.log >&2
cat >&2 <<'MESSAGE'

The VPS cannot authenticate to GitHub.
Add the VPS SSH public key to GitHub with read access to the Athena repo.
MESSAGE
exit 1
REMOTE_SCRIPT
}

deploy_static_app() {
  local app_name="$1"
  local package_dir="$2"
  local env_script="$3"

  remote_script "$REMOTE_SOURCE_DIR" "$ATHENA_ROOT" "$app_name" "$package_dir" "$env_script" "$DEPLOY_REF" <<'REMOTE_SCRIPT'
set -euo pipefail

REMOTE_SOURCE_DIR="$1"
ATHENA_ROOT="$2"
APP_NAME="$3"
PACKAGE_DIR="$4"
ENV_SCRIPT="$5"
DEPLOY_REF="$6"

export BUN_INSTALL="${BUN_INSTALL:-/root/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

timestamp="$(date -u +%Y%m%d%H%M%S)"
deployed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
version_path="$ATHENA_ROOT/$APP_NAME/versions/$timestamp"
current_path="$ATHENA_ROOT/$APP_NAME/current"
git_sha="$(git -C "$REMOTE_SOURCE_DIR" rev-parse HEAD)"
fun_name="$(awk 'BEGIN {
  split("brave clever happy quick silent wild gentle proud tiny wise", a)
  split("tiger eagle panda fox whale lion wolf bear owl dolphin", n)
  split("jumps runs flies swims roars climbs glides prowls soars dashes", v)
  srand()
  print a[int(rand()*10)+1] "-" n[int(rand()*10)+1] "-" v[int(rand()*10)+1]
}')"

cd "$REMOTE_SOURCE_DIR/$PACKAGE_DIR"
rm -rf dist
eval "$ENV_SCRIPT bun run build"

mkdir -p "$version_path"
printf '%s\n' "$fun_name" > "$version_path/fun-name.txt"
cp -R dist/. "$version_path/"
cat > "$version_path/deploy.json" <<DEPLOY_JSON
{
  "app": "$APP_NAME",
  "package_dir": "$PACKAGE_DIR",
  "version": "$timestamp",
  "fun_name": "$fun_name",
  "git_sha": "$git_sha",
  "deploy_ref": "$DEPLOY_REF",
  "deployed_at": "$deployed_at"
}
DEPLOY_JSON
ln -sfn "$version_path" "$current_path"

printf '%s deployed: %s (%s, %s)\n' "$APP_NAME" "$fun_name" "$timestamp" "${git_sha:0:12}"
REMOTE_SCRIPT
}

build_static_app_locally() {
  local package_dir="$1"
  local env_script="$2"

  (
    cd "$package_dir"
    rm -rf dist
    eval "$env_script bun run build"
  )
}

generate_fun_name() {
  awk 'BEGIN {
    split("brave clever happy quick silent wild gentle proud tiny wise", a)
    split("tiger eagle panda fox whale lion wolf bear owl dolphin", n)
    split("jumps runs flies swims roars climbs glides prowls soars dashes", v)
    srand()
    print a[int(rand()*10)+1] "-" n[int(rand()*10)+1] "-" v[int(rand()*10)+1]
  }'
}

upload_static_app_build() {
  local app_name="$1"
  local package_dir="$2"
  local version="$3"
  local fun_name="$4"
  local git_sha="$5"
  local deployed_at="$6"
  local version_path="$ATHENA_ROOT/$app_name/versions/$version"
  local current_path="$ATHENA_ROOT/$app_name/current"

  if [ ! -d "$package_dir/dist" ]; then
    printf 'Missing local build output at %s/dist.\n' "$package_dir" >&2
    return 1
  fi

  remote_script "$version_path" <<'REMOTE_SCRIPT'
set -euo pipefail

VERSION_PATH="$1"

rm -rf "$VERSION_PATH"
mkdir -p "$VERSION_PATH"
REMOTE_SCRIPT

  rsync -a --delete "$package_dir/dist/" "$REMOTE:$version_path/"

  remote_script "$app_name" "$package_dir" "$version" "$fun_name" "$git_sha" "$DEPLOY_REF" "$deployed_at" "$version_path" "$current_path" <<'REMOTE_SCRIPT'
set -euo pipefail

APP_NAME="$1"
PACKAGE_DIR="$2"
VERSION="$3"
FUN_NAME="$4"
GIT_SHA="$5"
DEPLOY_REF="$6"
DEPLOYED_AT="$7"
VERSION_PATH="$8"
CURRENT_PATH="$9"

printf '%s\n' "$FUN_NAME" > "$VERSION_PATH/fun-name.txt"
cat > "$VERSION_PATH/deploy.json" <<DEPLOY_JSON
{
  "app": "$APP_NAME",
  "package_dir": "$PACKAGE_DIR",
  "version": "$VERSION",
  "fun_name": "$FUN_NAME",
  "git_sha": "$GIT_SHA",
  "deploy_ref": "$DEPLOY_REF",
  "deployed_at": "$DEPLOYED_AT",
  "built_on": "local"
}
DEPLOY_JSON
ln -sfn "$VERSION_PATH" "$CURRENT_PATH"

printf '%s deployed from local build: %s (%s, %s)\n' "$APP_NAME" "$FUN_NAME" "$VERSION" "${GIT_SHA:0:12}"
REMOTE_SCRIPT
}

deploy_static_app_local() {
  local app_name="$1"
  local package_dir="$2"
  local env_script="$3"
  local version
  local fun_name
  local git_sha
  local deployed_at

  version="$(date -u +%Y%m%d%H%M%S)"
  fun_name="$(generate_fun_name)"
  git_sha="$(git rev-parse HEAD)"
  deployed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  build_static_app_locally "$package_dir" "$env_script"
  upload_static_app_build "$app_name" "$package_dir" "$version" "$fun_name" "$git_sha" "$deployed_at"
}

deploy_athena() {
  deploy_static_app \
    "athena-webapp" \
    "packages/athena-webapp" \
    "VITE_CONVEX_URL=$PROD_CONVEX_CLOUD VITE_API_GATEWAY_URL=$PROD_CONVEX_SITE VITE_STOREFRONT_URL=$STOREFRONT_URL"
}

deploy_athena_local() {
  deploy_static_app_local \
    "athena-webapp" \
    "packages/athena-webapp" \
    "VITE_CONVEX_URL=$PROD_CONVEX_CLOUD VITE_API_GATEWAY_URL=$PROD_CONVEX_SITE VITE_STOREFRONT_URL=$STOREFRONT_URL"
}

deploy_storefront() {
  deploy_static_app \
    "storefront" \
    "packages/storefront-webapp" \
    "VITE_API_URL=$PROD_API_URL"
}

deploy_storefront_local() {
  deploy_static_app_local \
    "storefront" \
    "packages/storefront-webapp" \
    "VITE_API_URL=$PROD_API_URL"
}

deploy_valkey_proxy() {
  remote_script "$REMOTE_SOURCE_DIR" "$ATHENA_ROOT" <<'REMOTE_SCRIPT'
set -euo pipefail

REMOTE_SOURCE_DIR="$1"
ATHENA_ROOT="$2"

mkdir -p "$ATHENA_ROOT/valkey-proxy-server"
rsync -a --delete \
  --exclude node_modules \
  "$REMOTE_SOURCE_DIR/packages/valkey-proxy-server/" \
  "$ATHENA_ROOT/valkey-proxy-server/"

cd "$ATHENA_ROOT/valkey-proxy-server"
npm install --omit=dev

if pm2 describe valkey-proxy >/dev/null 2>&1; then
  pm2 restart valkey-proxy
else
  pm2 start index.js --name valkey-proxy
fi

pm2 save
REMOTE_SCRIPT
}

deploy_athena_qa() {
  remote_script "$REMOTE_SOURCE_DIR" "$ATHENA_QA_PORT" "$DEV_CONVEX_CLOUD" "$DEV_CONVEX_SITE" "$ATHENA_QA_HOST" <<'REMOTE_SCRIPT'
set -euo pipefail

REMOTE_SOURCE_DIR="$1"
ATHENA_QA_PORT="$2"
DEV_CONVEX_CLOUD="$3"
DEV_CONVEX_SITE="$4"
ATHENA_QA_HOST="$5"

export BUN_INSTALL="${BUN_INSTALL:-/root/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

cd "$REMOTE_SOURCE_DIR/packages/athena-webapp"

if pm2 describe athena-qa >/dev/null 2>&1; then
  pm2 delete athena-qa
fi

VITE_CONVEX_URL="$DEV_CONVEX_CLOUD" \
VITE_API_GATEWAY_URL="$DEV_CONVEX_SITE" \
  pm2 start bun --name athena-qa -- run dev -- --host 127.0.0.1 --port "$ATHENA_QA_PORT" --strictPort

pm2 save

printf '\nAthena QA is a Vite dev server exposed through %s.\nProtect it with Cloudflare Access or equivalent edge auth before sharing it broadly.\n' "$ATHENA_QA_HOST" >&2
REMOTE_SCRIPT
}

configure_storefront_qa_nginx() {
  remote_script "$STOREFRONT_QA_HOST" "$STOREFRONT_QA_PORT" <<'REMOTE_SCRIPT'
set -euo pipefail

STOREFRONT_QA_HOST="$1"
STOREFRONT_QA_PORT="$2"
config_file="/etc/nginx/conf.d/wigclub.conf"

if [ ! -f "$config_file" ]; then
  printf 'Missing %s. Run scripts/setup-production-vps.sh first.\n' "$config_file" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  apt-get update
  apt-get install -y python3
fi

python3 - "$config_file" "$STOREFRONT_QA_HOST" "$STOREFRONT_QA_PORT" <<'PY'
import re
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
host = sys.argv[2]
port = sys.argv[3]
text = config_path.read_text()
replacement = f"""server {{
    listen 80;
    server_name {host};

    location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }}
}}
"""


def server_blocks(source):
    position = 0
    pattern = re.compile(r"\bserver\s*\{")

    while True:
        match = pattern.search(source, position)
        if not match:
            return

        start = match.start()
        brace = source.find("{", match.start())
        depth = 0

        for index in range(brace, len(source)):
            char = source[index]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    yield start, index + 1, source[start : index + 1]
                    position = index + 1
                    break
        else:
            raise SystemExit("Could not parse nginx server block.")


host_pattern = re.compile(
    r"^\s*server_name\s+[^;]*\b" + re.escape(host) + r"\b[^;]*;",
    re.MULTILINE,
)

for start, end, block in server_blocks(text):
    if host_pattern.search(block):
        text = text[:start] + replacement + text[end:]
        break
else:
    text = text.rstrip() + "\n\n" + replacement

config_path.write_text(text)
PY

nginx -t
systemctl reload nginx
REMOTE_SCRIPT
}

configure_api_gateway_cors() {
  remote_script "$STOREFRONT_QA_HOST" <<'REMOTE_SCRIPT'
set -euo pipefail

STOREFRONT_QA_HOST="$1"
config_file="/etc/nginx/conf.d/wigclub.conf"

if [ ! -f "$config_file" ]; then
  printf 'Missing %s. Run scripts/setup-production-vps.sh first.\n' "$config_file" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  apt-get update
  apt-get install -y python3
fi

python3 - "$config_file" "https://$STOREFRONT_QA_HOST" <<'PY'
import re
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
origin = sys.argv[2]
text = config_path.read_text()
entry = f'    "{origin}" "{origin}";'
map_match = re.search(
    r"map\s+\$http_origin\s+\$cors_allow_origin\s*\{(?P<body>.*?)\n\}",
    text,
    re.DOTALL,
)

if not map_match:
    raise SystemExit("Could not find the nginx CORS origin map.")

if entry not in map_match.group("body"):
    insert_at = map_match.end("body")
    text = text[:insert_at] + "\n" + entry + text[insert_at:]
    config_path.write_text(text)
PY

nginx -t
systemctl reload nginx
REMOTE_SCRIPT
}

deploy_storefront_qa() {
  configure_storefront_qa_nginx
  configure_api_gateway_cors

  remote_script "$REMOTE_SOURCE_DIR" "$STOREFRONT_QA_PORT" "$DEV_API_URL" "$STOREFRONT_QA_HOST" <<'REMOTE_SCRIPT'
set -euo pipefail

REMOTE_SOURCE_DIR="$1"
STOREFRONT_QA_PORT="$2"
DEV_API_URL="$3"
STOREFRONT_QA_HOST="$4"

export BUN_INSTALL="${BUN_INSTALL:-/root/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

cd "$REMOTE_SOURCE_DIR/packages/storefront-webapp"

if pm2 describe storefront-qa >/dev/null 2>&1; then
  pm2 delete storefront-qa
fi

VITE_API_URL="$DEV_API_URL" \
STOREFRONT_QA_HOST="$STOREFRONT_QA_HOST" \
  pm2 start bun --name storefront-qa -- run dev -- --host 127.0.0.1 --port "$STOREFRONT_QA_PORT" --strictPort

pm2 save

printf '\nStorefront QA is a Vite dev server exposed through %s.\nProtect it with Cloudflare Access or equivalent edge auth before sharing it broadly.\n' "$STOREFRONT_QA_HOST" >&2
REMOTE_SCRIPT
}

deploy_qa() {
  deploy_athena_qa
  deploy_storefront_qa
}

prod_convex_deployment() {
  local host
  host="${PROD_CONVEX_CLOUD#https://}"
  host="${host#http://}"
  host="${host%%/*}"
  host="${host%.convex.cloud}"

  if [[ -z "$host" || "$host" == "$PROD_CONVEX_CLOUD" ]]; then
    cat >&2 <<'MESSAGE'
Could not infer the production Convex deployment from PROD_CONVEX_CLOUD.
Set CONVEX_DEPLOYMENT=prod:<deployment-name> and rerun the deploy.
MESSAGE
    return 1
  fi

  printf 'prod:%s\n' "$host"
}

deploy_convex_prod() {
  local deployment
  deployment="${CONVEX_DEPLOYMENT:-$(prod_convex_deployment)}"

  if [[ "$deployment" != prod:* ]]; then
    cat >&2 <<MESSAGE
Refusing to run production Convex deploy with CONVEX_DEPLOYMENT=$deployment.
Set CONVEX_DEPLOYMENT to a prod deployment, or unset it so this script can infer
the production deployment from PROD_CONVEX_CLOUD.
MESSAGE
    return 1
  fi

  (
    cd packages/athena-webapp
    CONVEX_DEPLOYMENT="$deployment" npx convex deploy
  )
}

show_versions() {
  local app
  app="$(normalize_static_app "$1")"

  remote_script "$ATHENA_ROOT" "$app" <<'REMOTE_SCRIPT'
set -euo pipefail

ATHENA_ROOT="$1"
APP_NAME="$2"
versions_dir="$ATHENA_ROOT/$APP_NAME/versions"
current_path="$ATHENA_ROOT/$APP_NAME/current"
current_version=""

if [ -L "$current_path" ]; then
  current_version="$(basename "$(readlink "$current_path")")"
fi

if [ ! -d "$versions_dir" ]; then
  printf '%s has no deployed versions at %s\n' "$APP_NAME" "$versions_dir" >&2
  exit 1
fi

find "$versions_dir" -mindepth 1 -maxdepth 1 -type d -print | sort -r | while IFS= read -r version_path; do
  version="$(basename "$version_path")"
  fun_name_file="$version_path/fun-name.txt"
  deploy_json="$version_path/deploy.json"
  marker=""
  fun_name=""
  git_sha=""

  if [ "$version" = "$current_version" ]; then
    marker=" current"
  fi

  if [ -f "$fun_name_file" ]; then
    fun_name=" $(cat "$fun_name_file")"
  fi

  if [ -f "$deploy_json" ]; then
    git_sha="$(awk -F\" '/"git_sha"/ { print substr($4, 1, 12); exit }' "$deploy_json")"
  fi

  if [ -n "$git_sha" ]; then
    printf '%s%s %s%s\n' "$version" "$fun_name" "$git_sha" "$marker"
  else
    printf '%s%s%s\n' "$version" "$fun_name" "$marker"
  fi
done
REMOTE_SCRIPT
}

rollback_static_app() {
  local app
  local target_version="${2:-}"

  app="$(normalize_static_app "$1")"

  if [ -z "$target_version" ]; then
    cat >&2 <<'MESSAGE'
Rollback requires a target version or "previous".
Example:
  scripts/deploy-vps.sh rollback athena previous
  scripts/deploy-vps.sh rollback storefront 20260502063412
MESSAGE
    return 1
  fi

  remote_script "$ATHENA_ROOT" "$app" "$target_version" <<'REMOTE_SCRIPT'
set -euo pipefail

ATHENA_ROOT="$1"
APP_NAME="$2"
TARGET_VERSION="$3"
versions_dir="$ATHENA_ROOT/$APP_NAME/versions"
current_path="$ATHENA_ROOT/$APP_NAME/current"

if [ ! -d "$versions_dir" ]; then
  printf '%s has no deployed versions at %s\n' "$APP_NAME" "$versions_dir" >&2
  exit 1
fi

if [ ! -L "$current_path" ]; then
  printf '%s has no current symlink at %s\n' "$APP_NAME" "$current_path" >&2
  exit 1
fi

current_version="$(basename "$(readlink "$current_path")")"

if [ "$TARGET_VERSION" = "previous" ]; then
  TARGET_VERSION="$(
    find "$versions_dir" -mindepth 1 -maxdepth 1 -type d -print |
      sed "s#^$versions_dir/##" |
      sort -r |
      awk -v current="$current_version" '$0 != current { print; exit }'
  )"

  if [ -z "$TARGET_VERSION" ]; then
    printf '%s has no previous version to roll back to.\n' "$APP_NAME" >&2
    exit 1
  fi
fi

target_path="$versions_dir/$TARGET_VERSION"

if [ ! -d "$target_path" ]; then
  printf 'Version %s does not exist for %s.\n' "$TARGET_VERSION" "$APP_NAME" >&2
  printf 'Available versions:\n' >&2
  find "$versions_dir" -mindepth 1 -maxdepth 1 -type d -print |
    sed "s#^$versions_dir/##" |
    sort -r >&2
  exit 1
fi

if [ "$TARGET_VERSION" = "$current_version" ]; then
  printf '%s already points at %s.\n' "$APP_NAME" "$TARGET_VERSION"
  exit 0
fi

ln -sfn "$target_path" "$current_path"

fun_name_file="$target_path/fun-name.txt"
deploy_json="$target_path/deploy.json"
fun_name=""
git_sha=""
if [ -f "$fun_name_file" ]; then
  fun_name=" ($(cat "$fun_name_file"))"
fi
if [ -f "$deploy_json" ]; then
  git_sha="$(awk -F\" '/"git_sha"/ { print substr($4, 1, 12); exit }' "$deploy_json")"
fi

if [ -n "$git_sha" ]; then
  git_sha=" $git_sha"
fi

printf '%s rolled back: %s -> %s%s%s\n' "$APP_NAME" "$current_version" "$TARGET_VERSION" "$fun_name" "$git_sha"
REMOTE_SCRIPT
}

show_status() {
  remote_script "$ATHENA_ROOT" <<'REMOTE_SCRIPT'
set -euo pipefail

ATHENA_ROOT="$1"

printf '%s\n' '--- static versions ---'
for app in athena-webapp storefront; do
  current="$ATHENA_ROOT/$app/current"
  if [ -L "$current" ]; then
    version="$(basename "$(readlink "$current")")"
    fun_name_file="$ATHENA_ROOT/$app/versions/$version/fun-name.txt"
    if [ -f "$fun_name_file" ]; then
      printf '%s: %s (%s)\n' "$app" "$(cat "$fun_name_file")" "$version"
    else
      printf '%s: %s\n' "$app" "$version"
    fi
  else
    printf '%s: not deployed\n' "$app"
  fi
done

printf '%s\n' '--- services ---'
systemctl is-active nginx cloudflared valkey-server || true
pm2 list

printf '%s\n' '--- listeners ---'
ss -tulpn | grep -E ':(80|3000|5175|5176)\b' || true
REMOTE_SCRIPT
}

command="${1:-}"

case "$command" in
  status)
    show_status "$ATHENA_ROOT"
    ;;
  versions)
    show_versions "${2:-}"
    ;;
  check-git)
    check_git
    ;;
  athena)
    require_remote_source "$REMOTE_REPO" "$REMOTE_SOURCE_DIR" "$DEPLOY_REF"
    deploy_athena "$REMOTE_SOURCE_DIR" "$ATHENA_ROOT"
    ;;
  athena-local)
    deploy_athena_local
    ;;
  storefront)
    require_remote_source "$REMOTE_REPO" "$REMOTE_SOURCE_DIR" "$DEPLOY_REF"
    deploy_storefront "$REMOTE_SOURCE_DIR" "$ATHENA_ROOT"
    ;;
  storefront-local)
    deploy_storefront_local
    ;;
  valkey-proxy)
    require_remote_source "$REMOTE_REPO" "$REMOTE_SOURCE_DIR" "$DEPLOY_REF"
    deploy_valkey_proxy "$REMOTE_SOURCE_DIR" "$ATHENA_ROOT"
    ;;
  qa)
    require_remote_source "$REMOTE_REPO" "$REMOTE_SOURCE_DIR" "$DEPLOY_REF"
    deploy_qa
    ;;
  qa-athena)
    require_remote_source "$REMOTE_REPO" "$REMOTE_SOURCE_DIR" "$DEPLOY_REF"
    deploy_athena_qa
    ;;
  qa-storefront)
    require_remote_source "$REMOTE_REPO" "$REMOTE_SOURCE_DIR" "$DEPLOY_REF"
    deploy_storefront_qa
    ;;
  convex-prod)
    deploy_convex_prod
    ;;
  full-prod)
    require_remote_source "$REMOTE_REPO" "$REMOTE_SOURCE_DIR" "$DEPLOY_REF"
    deploy_convex_prod
    deploy_athena "$REMOTE_SOURCE_DIR" "$ATHENA_ROOT"
    deploy_storefront "$REMOTE_SOURCE_DIR" "$ATHENA_ROOT"
    deploy_valkey_proxy "$REMOTE_SOURCE_DIR" "$ATHENA_ROOT"
    ;;
  full-prod-local)
    require_remote_source "$REMOTE_REPO" "$REMOTE_SOURCE_DIR" "$DEPLOY_REF"
    deploy_convex_prod
    deploy_athena_local
    deploy_storefront_local
    deploy_valkey_proxy "$REMOTE_SOURCE_DIR" "$ATHENA_ROOT"
    ;;
  all)
    require_remote_source "$REMOTE_REPO" "$REMOTE_SOURCE_DIR" "$DEPLOY_REF"
    deploy_convex_prod
    deploy_athena "$REMOTE_SOURCE_DIR" "$ATHENA_ROOT"
    deploy_storefront "$REMOTE_SOURCE_DIR" "$ATHENA_ROOT"
    deploy_valkey_proxy "$REMOTE_SOURCE_DIR" "$ATHENA_ROOT"
    deploy_qa
    ;;
  rollback)
    rollback_static_app "${2:-}" "${3:-}"
    ;;
  rollback-athena)
    rollback_static_app "athena-webapp" "${2:-}"
    ;;
  rollback-storefront)
    rollback_static_app "storefront" "${2:-}"
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
