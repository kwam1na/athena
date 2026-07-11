type PosLocalActivityReportStatus =
  "pending" | "reported" | "mapping_pending" | "failed";
type PosLocalSyncEventStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "locally_resolved"
  | "needs_review"
  | "failed";

export type PosLocalLedgerRetentionFacts = {
  activityStatus: PosLocalActivityReportStatus | undefined;
  hasReceiptDependency: boolean;
  hasWorkflowDependency: boolean;
  requiresActivitySettlement: boolean;
  syncStatus: PosLocalSyncEventStatus;
  uploadDeferred: boolean;
};

export type PosLocalLedgerRetentionAssessment =
  | { eligible: true; reason: "settled_unreferenced" }
  | {
      eligible: false;
      reason:
        | "activity_unsettled"
        | "receipt_dependency"
        | "review_required"
        | "unsettled_sync"
        | "upload_deferred"
        | "workflow_dependency";
    };

/** Classification only. Deliberately exposes no deletion capability. */
export function assessPosLocalLedgerRetention(
  facts: PosLocalLedgerRetentionFacts,
): PosLocalLedgerRetentionAssessment {
  if (facts.syncStatus === "needs_review")
    return { eligible: false, reason: "review_required" };
  if (
    facts.syncStatus !== "synced" &&
    facts.syncStatus !== "locally_resolved"
  ) {
    return { eligible: false, reason: "unsettled_sync" };
  }
  if (facts.uploadDeferred)
    return { eligible: false, reason: "upload_deferred" };
  if (facts.requiresActivitySettlement && facts.activityStatus !== "reported") {
    return { eligible: false, reason: "activity_unsettled" };
  }
  if (facts.hasWorkflowDependency)
    return { eligible: false, reason: "workflow_dependency" };
  if (facts.hasReceiptDependency)
    return { eligible: false, reason: "receipt_dependency" };
  return { eligible: true, reason: "settled_unreferenced" };
}
