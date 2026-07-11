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
      }),
    ).toEqual({ eligible: true, reason: "settled_unreferenced" });
  });
});
