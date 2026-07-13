#!/usr/bin/env bash
set -euo pipefail

deployment="${1:-dev}"
case "$deployment" in
  dev|local) ;;
  *)
    echo "Refusing reporting purge: deployment must be exactly 'dev' or 'local'." >&2
    exit 1
    ;;
esac

tables=(
  reportingIngress
  reportingIngressSourceReference
  reportingIngressLine
  reportingIngressConflict
  reportingFact
  reportingFactSourceReference
  reportingFactProcessingAttempt
  reportingSkuAttribution
  reportingSkuAttributionCursor
  reportingSkuAttributionAppliedSequence
  reportingProjectionGeneration
  reportingProjectionActivation
  reportingStoreDayProjection
  reportingStoreIntradayProjection
  reportingStoreIntradayScheduleState
  reportingSkuDayProjection
  reportingCurrentValuationProjection
  reportingRangeProjection
  reportingAttentionProjection
  reportingDailyCloseProjection
  reportingSkuInsightProjection
  reportingMetricCoverage
  reportingStorePeriodSummary
  reportingSkuPeriodSummary
  reportingSkuPeriodClassification
  reportingPeriodRollup
  reportingPeriodFacet
  reportingInventoryExposureSummary
  reportingInventoryMovementSummary
  reportingInventoryPeriodSummary
  reportingDailyCloseTrust
  reportingReadCursorContext
  reportingWorkspaceMaterializationEpoch
  reportingWorkspaceReadModelActivation
  reportingReadBundle
  reportingReadBundleActivation
  reportingProjectionEvidence
  reportingSkuEvidence
  reportingRun
  reportingRunEvent
  reportingProjectionHealth
  reportingHistoricalInterpretationPolicy
  reportingHistoricalInterpretationEvidence
  reportingPosSourceReconciliation
  reportingExportChunk
  reportingCutoverPreviewItem
  reportingCutoverBaselineDeficitLot
  reportingCutoverBaseline
  reportingBackfillSourceAudit
  reportingBackfillPreviewItem
  reportingBackfillApplyManifest
  reportingBackfillApplyManifestItem
  reportingQuarantine
  reportingReconciliationDiscrepancy
  reportingReconciliationAccumulator
  reportingBackfillAuthorizationGrant
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
