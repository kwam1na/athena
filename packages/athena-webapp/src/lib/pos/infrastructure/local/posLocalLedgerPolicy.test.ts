import { describe, expect, it } from "vitest";

import { assessPosLocalLedgerRetention } from "./posLocalLedgerPolicy";

describe("assessPosLocalLedgerRetention", () => {
  it.each([
    ["pending", "unsettled_sync"],
    ["syncing", "unsettled_sync"],
    ["failed", "unsettled_sync"],
    ["needs_review", "review_required"],
  ] as const)("protects %s events", (status, reason) => {
    expect(
      assessPosLocalLedgerRetention({
        activityStatus: "reported",
        hasReceiptDependency: false,
        hasWorkflowDependency: false,
        requiresActivitySettlement: true,
        syncStatus: status,
        uploadDeferred: false,
        serverConfirmedResolution: true,
        pastRetentionBoundary: true,
      }),
    ).toEqual({ eligible: false, reason });
  });

  it("classifies settled unreferenced evidence without authorizing deletion", () => {
    expect(
      assessPosLocalLedgerRetention({
        activityStatus: "reported",
        hasReceiptDependency: false,
        hasWorkflowDependency: false,
        requiresActivitySettlement: true,
        syncStatus: "synced",
        uploadDeferred: false,
        serverConfirmedResolution: true,
        pastRetentionBoundary: true,
      }),
    ).toEqual({ eligible: true, reason: "settled_unreferenced" });
  });

  it("protects activity-bearing evidence when settlement state is missing", () => {
    expect(
      assessPosLocalLedgerRetention({
        activityStatus: undefined,
        hasReceiptDependency: false,
        hasWorkflowDependency: false,
        requiresActivitySettlement: true,
        syncStatus: "synced",
        uploadDeferred: false,
        serverConfirmedResolution: true,
        pastRetentionBoundary: true,
      }),
    ).toEqual({ eligible: false, reason: "activity_unsettled" });
  });

  it("does not invent an activity dependency for event types without one", () => {
    expect(
      assessPosLocalLedgerRetention({
        activityStatus: undefined,
        hasReceiptDependency: false,
        hasWorkflowDependency: false,
        requiresActivitySettlement: false,
        syncStatus: "synced",
        uploadDeferred: false,
        serverConfirmedResolution: true,
        pastRetentionBoundary: true,
      }),
    ).toEqual({ eligible: true, reason: "settled_unreferenced" });
  });

  it("retains a settled event that is still within the active retention boundary", () => {
    expect(
      assessPosLocalLedgerRetention({
        activityStatus: "reported",
        hasReceiptDependency: false,
        hasWorkflowDependency: false,
        requiresActivitySettlement: true,
        syncStatus: "synced",
        uploadDeferred: false,
        serverConfirmedResolution: true,
        pastRetentionBoundary: false,
      }),
    ).toEqual({ eligible: false, reason: "within_active_boundary" });
  });

  it("purges a settled unreferenced event only once it is past the retention boundary", () => {
    expect(
      assessPosLocalLedgerRetention({
        activityStatus: "reported",
        hasReceiptDependency: false,
        hasWorkflowDependency: false,
        requiresActivitySettlement: true,
        syncStatus: "locally_resolved",
        uploadDeferred: false,
        serverConfirmedResolution: true,
        pastRetentionBoundary: true,
      }),
    ).toEqual({ eligible: true, reason: "settled_unreferenced" });
  });

  it("never purges a locally-cleared review the server has not confirmed", () => {
    expect(
      assessPosLocalLedgerRetention({
        activityStatus: "reported",
        hasReceiptDependency: false,
        hasWorkflowDependency: false,
        requiresActivitySettlement: true,
        syncStatus: "locally_resolved",
        uploadDeferred: false,
        serverConfirmedResolution: false,
        pastRetentionBoundary: true,
      }),
    ).toEqual({ eligible: false, reason: "unsettled_sync" });
  });

  it("keeps protecting an unsettled event even when it is past the boundary", () => {
    expect(
      assessPosLocalLedgerRetention({
        activityStatus: "reported",
        hasReceiptDependency: false,
        hasWorkflowDependency: false,
        requiresActivitySettlement: true,
        syncStatus: "pending",
        uploadDeferred: false,
        serverConfirmedResolution: true,
        pastRetentionBoundary: true,
      }),
    ).toEqual({ eligible: false, reason: "unsettled_sync" });
  });
});
