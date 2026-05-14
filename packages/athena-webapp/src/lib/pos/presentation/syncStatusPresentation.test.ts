import { describe, expect, it } from "vitest";

import {
  buildPosSyncStatusPresentation,
  formatPosReconciliationType,
} from "./syncStatusPresentation";

describe("buildPosSyncStatusPresentation", () => {
  it.each([
    ["pending", "pending_sync"],
    ["offline", "pending_sync"],
    ["local_closed", "locally_closed_pending_sync"],
    ["closed_pending_sync", "locally_closed_pending_sync"],
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
    ["register_closeout", "Closeout review"],
    ["unknown", "Reconciliation review"],
    [null, "Reconciliation review"],
  ])("formats %s as %s", (type, expected) => {
    expect(formatPosReconciliationType(type)).toBe(expected);
  });
});
