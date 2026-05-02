#!/usr/bin/env bash
set -euo pipefail

ATHENA_ROOT="${ATHENA_ROOT:-/root/athena}"
PROD_CONVEX_SITE="${PROD_CONVEX_SITE:-https://colorless-cardinal-870.convex.site}"
DEV_CONVEX_SITE="${DEV_CONVEX_SITE:-https://jovial-wildebeest-179.convex.site}"
STOREFRONT_HOST="${STOREFRONT_HOST:-wigclub.store}"
STOREFRONT_WWW_HOST="${STOREFRONT_WWW_HOST:-www.wigclub.store}"
ATHENA_HOST="${ATHENA_HOST:-athena.wigclub.store}"
STOREFRONT_QA_HOST="${STOREFRONT_QA_HOST:-qa.wigclub.store}"
ATHENA_QA_HOST="${ATHENA_QA_HOST:-athena-qa.wigclub.store}"
ATHENA_QA_PORT="${ATHENA_QA_PORT:-${QA_PORT:-5175}}"
STOREFRONT_QA_PORT="${STOREFRONT_QA_PORT:-5176}"
API_HOST="${API_HOST:-api.wigclub.store}"
DEV_API_HOST="${DEV_API_HOST:-dev.wigclub.store}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root on a fresh Ubuntu VPS." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl git gnupg nginx rsync valkey-server

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

npm install -g pm2

mkdir -p \
  "$ATHENA_ROOT/athena-webapp/versions" \
  "$ATHENA_ROOT/storefront/versions" \
  "$ATHENA_ROOT/valkey-proxy-server"

rm -f /etc/nginx/sites-enabled/default

cat >/etc/nginx/conf.d/wigclub.conf <<NGINX
map \$http_origin \$cors_allow_origin {
    default "";
    "http://localhost:5174" "http://localhost:5174";
    "https://$STOREFRONT_HOST" "https://$STOREFRONT_HOST";
    "https://$STOREFRONT_WWW_HOST" "https://$STOREFRONT_WWW_HOST";
    "https://$STOREFRONT_QA_HOST" "https://$STOREFRONT_QA_HOST";
}

resolver 127.0.0.53 valid=300s ipv6=off;

server {
    listen 80;
    server_name $STOREFRONT_HOST $STOREFRONT_WWW_HOST;
    root $ATHENA_ROOT/storefront/current;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}

server {
    listen 80;
    server_name $ATHENA_HOST;
    root $ATHENA_ROOT/athena-webapp/current;
    index index.html;

    location / {
        try_files \$uri /index.html;
    }
}

server {
    listen 80;
    server_name $STOREFRONT_QA_HOST;

    location / {
        proxy_pass http://127.0.0.1:$STOREFRONT_QA_PORT;
        proxy_http_version 1.1;

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

server {
    listen 80;
    server_name $ATHENA_QA_HOST;

    location / {
        proxy_pass http://127.0.0.1:$ATHENA_QA_PORT;
        proxy_http_version 1.1;

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

server {
    listen 80;
    server_name $API_HOST;

    location / {
        if (\$request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin \$cors_allow_origin always;
            add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Authorization, Origin, Content-Type, Accept" always;
            add_header Access-Control-Allow-Credentials "true" always;
            add_header Vary "Origin" always;
            add_header Content-Length 0;
            add_header Content-Type "text/plain; charset=UTF-8";
            return 204;
        }

        proxy_hide_header Access-Control-Allow-Origin;
        proxy_hide_header Access-Control-Allow-Methods;
        proxy_hide_header Access-Control-Allow-Headers;
        proxy_hide_header Access-Control-Allow-Credentials;

        add_header Access-Control-Allow-Origin \$cors_allow_origin always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Origin, Content-Type, Accept" always;
        add_header Access-Control-Allow-Credentials "true" always;
        add_header Vary "Origin" always;

        set \$convex_upstream $PROD_CONVEX_SITE;
        proxy_ssl_server_name on;
        proxy_pass \$convex_upstream;
        proxy_set_header Host ${PROD_CONVEX_SITE#https://};
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 80;
    server_name $DEV_API_HOST;

    location / {
        if (\$request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin \$cors_allow_origin always;
            add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Authorization, Origin, Content-Type, Accept" always;
            add_header Access-Control-Allow-Credentials "true" always;
            add_header Vary "Origin" always;
            add_header Content-Length 0;
            add_header Content-Type "text/plain; charset=UTF-8";
            return 204;
        }

        proxy_hide_header Access-Control-Allow-Origin;
        proxy_hide_header Access-Control-Allow-Methods;
        proxy_hide_header Access-Control-Allow-Headers;
        proxy_hide_header Access-Control-Allow-Credentials;

        add_header Access-Control-Allow-Origin \$cors_allow_origin always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Origin, Content-Type, Accept" always;
        add_header Access-Control-Allow-Credentials "true" always;
        add_header Vary "Origin" always;

        set \$convex_upstream $DEV_CONVEX_SITE;
        proxy_ssl_server_name on;
        proxy_pass \$convex_upstream;
        proxy_set_header Host ${DEV_CONVEX_SITE#https://};
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

nginx -t
systemctl enable --now nginx
systemctl enable --now valkey-server
pm2 startup systemd -u root --hp /root >/dev/null
systemctl enable pm2-root

echo "Base VPS setup complete."
echo "Next: install cloudflared credentials, add the VPS GitHub deploy key, run scripts/deploy-vps.sh, then configure the Cloudflare Tunnel hostnames."
