#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cat >&2 <<'MESSAGE'
deploy-athena.sh is deprecated. Delegating to scripts/deploy-vps.sh.
MESSAGE

case "${1:-help}" in
  deploy-athena|athena)
    exec "$SCRIPT_DIR/scripts/deploy-vps.sh" athena
    ;;
  deploy-storefront|storefront)
    exec "$SCRIPT_DIR/scripts/deploy-vps.sh" storefront
    ;;
  full-deploy-athena|full-prod)
    exec "$SCRIPT_DIR/scripts/deploy-vps.sh" full-prod
    ;;
  dpb-athena|convex|convex-prod)
    exec "$SCRIPT_DIR/scripts/deploy-vps.sh" convex-prod
    ;;
  *)
    exec "$SCRIPT_DIR/scripts/deploy-vps.sh" "${1:-help}"
    ;;
esac
