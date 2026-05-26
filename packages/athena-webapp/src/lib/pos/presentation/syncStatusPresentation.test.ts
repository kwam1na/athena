import { describe, expect, it } from "vitest";

import {
  buildPosSyncStatusPresentation,
  formatPosReconciliationType,
  isRegisterCloseoutReviewItem,
} from "./syncStatusPresentation";

describe("buildPosSyncStatusPresentation", () => {
  it.each([
    ["pending", "pending_sync"],
    ["offline", "pending_sync"],
    ["local_closed", "locally_closed_pending_sync"],
    ["closed_pending_sync", "locally_closed_pending_sync"],
    ["stale", "pending_sync"],
    ["terminal_stale", "pending_sync"],
    ["pending_check_in", "pending_sync"],
    ["conflict", "needs_review"],
    ["conflicted", "needs_review"],
    ["review", "needs_review"],
    ["unexpected_status", "needs_review"],
    [null, "synced"],
    ["", "synced"],
  ])("normalizes %s to %s", (sourceStatus, expectedStatus) => {
    expect(
      buildPosSyncStatusPresentation({ status: sourceStatus }).status,
    ).toBe(expectedStatus);
  });

  it("uses trimmed label and description overrides", () => {
    expect(
      buildPosSyncStatusPresentation({
        description: "  Saved on this register  ",
        label: "  Local queue  ",
        status: "pending",
      }),
    ).toMatchObject({
      description: "Saved on this register",
      label: "Local queue",
      status: "pending_sync",
    });
  });

  it("describes synced closeout variance review distinctly", () => {
    expect(
      buildPosSyncStatusPresentation({
        reconciliationItems: [
          {
            localEventId: "event-register-closeout-1",
            summary:
              "Register closeout variance requires manager review before synced closeout can be applied.",
            type: "permission",
          },
        ],
        status: "needs_review",
      }),
    ).toMatchObject({
      description:
        "Synced register closeout has a variance. Review it before this closeout can be applied.",
      label: "Closeout review",
      status: "needs_review",
    });
  });

  it.each([
    [3, 3],
    [0, undefined],
    [-1, undefined],
    [Number.NaN, undefined],
  ])("sanitizes pending event count %s", (pendingEventCount, expected) => {
    expect(
      buildPosSyncStatusPresentation({
        pendingEventCount,
        status: "pending_sync",
      }).pendingEventCount,
    ).toBe(expected);
  });
});

describe("formatPosReconciliationType", () => {
  it.each([
    ["inventory", "Inventory review"],
    ["inventory_conflict", "Inventory review"],
    ["payment", "Payment review"],
    ["payment_record", "Payment review"],
    ["payment_conflict", "Payment review"],
    ["permission", "Permission review"],
    ["permission_drift", "Permission review"],
    ["register_closeout", "Closeout variance review"],
    ["unknown", "Reconciliation review"],
    [null, "Reconciliation review"],
  ])("formats %s as %s", (type, expected) => {
    expect(formatPosReconciliationType(type)).toBe(expected);
  });

  it("detects legacy closeout review items from local event evidence", () => {
    expect(
      isRegisterCloseoutReviewItem({
        localEventId: "event-register-closeout-1",
        summary:
          "Register closeout variance requires manager review before synced closeout can be applied.",
        type: "permission",
      }),
    ).toBe(true);
    expect(
      formatPosReconciliationType("permission", {
        localEventId: "event-register-closeout-1",
        summary:
          "Register closeout variance requires manager review before synced closeout can be applied.",
        type: "permission",
      }),
    ).toBe("Closeout variance review");
  });
});
