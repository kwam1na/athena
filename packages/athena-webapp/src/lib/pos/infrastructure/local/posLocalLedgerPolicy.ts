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
  /**
   * For a `locally_resolved` event, whether the server has acknowledged the
   * resolution. An unconfirmed local resolution has NOT converged with the
   * server (its conflict may still be open), so it must never be purged — the
   * local record is required to reconcile on the next sync. Ignored for other
   * statuses.
   */
  serverConfirmedResolution: boolean;
  /**
   * Whether the event has aged past the active store-day / register-session
   * retention boundary. Events inside the active boundary are never purged even
   * when otherwise settled, so an in-progress shift keeps its full local log.
   */
  pastRetentionBoundary: boolean;
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
        | "within_active_boundary"
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
  // A locally-cleared review that the server has not confirmed has not
  // converged — its conflict may still be open server-side — so it is treated
  // as unsettled and never purged, matching the sync-status surface.
  if (
    facts.syncStatus === "locally_resolved" &&
    !facts.serverConfirmedResolution
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
  if (!facts.pastRetentionBoundary)
    return { eligible: false, reason: "within_active_boundary" };
  return { eligible: true, reason: "settled_unreferenced" };
}
