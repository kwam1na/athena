#!/usr/bin/env bash
set -euo pipefail

# Empties the derived reporting tables on a development deployment.
#
# The fact ledger is included: reporting is fully derived from domain sources,
# so the supported way back is `reports/reseed:reseedStoreReporting`, which
# re-ingests facts and re-folds every day. That mutation is also the store-
# scoped version of this script and is preferred — reach for this one only
# when you want the tables empty across every store.

deployment="${1:-dev}"
case "$deployment" in
  dev|local) ;;
  *)
    echo "Refusing reporting purge: deployment must be exactly 'dev' or 'local'." >&2
    exit 1
    ;;
esac

tables=(
  reportFact
  reportDay
  reportSkuDay
  reportPeriodSkuRollup
  reportOverview
  reportDirtyDay
  reportRangeResult
)

for table in "${tables[@]}"; do
  bunx convex import \
    --deployment "$deployment" \
    --table "$table" \
    --replace \
    --yes \
    scripts/empty-table.json
done

echo "Development reporting state purged on '$deployment'."
