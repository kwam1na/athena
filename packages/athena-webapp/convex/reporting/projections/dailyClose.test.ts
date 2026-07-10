import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildDailyCloseSnapshot,
  decideDailyCloseLineage,
  reconcileDailyClose,
} from "./dailyClose";

describe("reporting Daily Close lineage", () => {
  it("preserves the accepted snapshot and reports late post-close delta", () => {
    expect(
      reconcileDailyClose({
        acceptedCloseId: "close-1",
        acceptedNetRevenueMinor: 10_000,
        currentNetRevenueMinor: 12_500,
        supersedesCloseId: null,
      }),
    ).toEqual({
      acceptedCloseId: "close-1",
      acceptedNetRevenueMinor: 10_000,
      currentNetRevenueMinor: 12_500,
      postCloseDeltaMinor: 2_500,
      supersedesCloseId: null,
    });
  });

  it("keeps reclosed source completeness and supersedes lineage immutable while current facts move", () => {
    const accepted = reconcileDailyClose({
      acceptedCloseId: "close-2",
      acceptedCloseVersion: 1,
      acceptedNetRevenueMinor: 12_000,
      acceptedSourceComplete: false,
      currentNetRevenueMinor: 12_000,
      supersedesCloseId: "close-1",
    });
    const afterLateSale = reconcileDailyClose({
      acceptedCloseId: accepted.acceptedCloseId,
      acceptedCloseVersion: accepted.acceptedCloseVersion,
      acceptedNetRevenueMinor: accepted.acceptedNetRevenueMinor,
      acceptedSourceComplete: accepted.acceptedSourceComplete,
      currentNetRevenueMinor: 14_500,
      supersedesCloseId: accepted.supersedesCloseId,
    });

    expect(afterLateSale).toMatchObject({
      acceptedCloseId: "close-2",
      acceptedCloseVersion: 1,
      acceptedCompleteness: "partial",
      acceptedNetRevenueMinor: 12_000,
      currentNetRevenueMinor: 14_500,
      postCloseDeltaMinor: 2_500,
      supersedesCloseId: "close-1",
    });
  });

  it("freezes accepted close values while updating only the current interpretation", () => {
    const accepted = buildDailyCloseSnapshot({
      acceptedCloseId: "close-3",
      acceptedCloseVersion: 2,
      acceptedCompleteness: "complete",
      acceptedDeficitAdjustmentMinor: 100,
      acceptedNetSalesMinor: 12_000,
      acceptedRefundsMinor: 500,
      currentDeficitAdjustmentMinor: 300,
      currentNetSalesMinor: 13_500,
      currentRefundsMinor: 700,
      supersedesCloseId: "close-2",
    });

    expect(accepted).toMatchObject({
      acceptedDeficitAdjustmentMinor: 100,
      acceptedNetSalesMinor: 12_000,
      acceptedRefundsMinor: 500,
      currentDeficitAdjustmentMinor: 300,
      currentNetSalesMinor: 13_500,
      currentRefundsMinor: 700,
      postCloseDeficitAdjustmentDeltaMinor: 200,
      postCloseKnownCogsDeltaMinor: 200,
      postCloseGrossProfitDeltaMinor: -200,
      postCloseNetSalesDeltaMinor: 1_500,
      postCloseRefundsDeltaMinor: 200,
    });
  });

  it("materializes through the shared incremental and rebuild processor", () => {
    const processor = readFileSync(
      join(process.cwd(), "convex", "reporting", "projections", "processor.ts"),
      "utf8",
    );
    const dailyClose = readFileSync(
      join(process.cwd(), "convex", "reporting", "projections", "dailyClose.ts"),
      "utf8",
    );
    expect(processor).toContain("await applyDailyCloseFactWithCtx(ctx, generation, fact)");
    expect(dailyClose).toContain('ctx.db.insert("reportingDailyCloseProjection"');
    expect(dailyClose).toContain("fact.closeSnapshot.acceptedNetSalesMinor");
    expect(dailyClose).toContain(
      'fact.adjustmentKind === "deficit_cogs_revaluation"',
    );
    expect(dailyClose).toContain("fact.cogsKnownMinor ?? 0");
    expect(dailyClose).not.toContain('.query("reportingStoreDayProjection")');
    expect(dailyClose).toContain('ctx.db.patch("reportingDailyCloseProjection", latest._id');
    expect(dailyClose).not.toContain('ctx.db.patch("reportingFact"');
  });

  it("orders close snapshots by immutable source version and supersedes identity", () => {
    expect(
      decideDailyCloseLineage({
        incomingSnapshotVersion: 1,
      }),
    ).toEqual({ action: "insert" });
    expect(
      decideDailyCloseLineage({
        incomingSnapshotVersion: 1,
        latestBusinessEventKey: "daily_close:close-2:completed:v2",
        latestSnapshotVersion: 2,
      }),
    ).toEqual({ action: "ignore_older_or_replayed" });
    expect(
      decideDailyCloseLineage({
        incomingSnapshotVersion: 3,
        incomingSupersedesCloseId: "close-2",
        latestBusinessEventKey: "daily_close:close-2:completed:v2",
        latestSnapshotVersion: 2,
      }),
    ).toEqual({ action: "insert" });
  });

  it("rejects gaps and mismatched Daily Close predecessors", () => {
    expect(() =>
      decideDailyCloseLineage({
        incomingSnapshotVersion: 3,
        incomingSupersedesCloseId: "close-1",
        latestBusinessEventKey: "daily_close:close-1:completed:v1",
        latestSnapshotVersion: 1,
      }),
    ).toThrow("not contiguous");
    expect(() =>
      decideDailyCloseLineage({
        incomingSnapshotVersion: 2,
        incomingSupersedesCloseId: "other-close",
        latestBusinessEventKey: "daily_close:close-1:completed:v1",
        latestSnapshotVersion: 1,
      }),
    ).toThrow("does not match");
  });
});
