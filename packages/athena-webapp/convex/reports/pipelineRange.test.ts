/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import type { Id } from "../_generated/dataModel";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { seedStore } from "./reseedTestSupport";
import { requestRangeCore } from "./customRange";
import {
  dispatchSummaryRangesWithCtx,
  applySummaryRangeBatchWithCtx,
  cleanupSummaryRangeWithCtx,
} from "./pipelineRange";
import { recordReadCosts } from "./readCostTestSupport";
import { recordFacts } from "./ingest";
import { claimDayWorkWithCtx, processDayWorkWithCtx } from "./pipelineDays";
import { REPORTS_SWEEP_STORE_ALLOWLIST_ENV } from "./sweeper";
import { REPORTS_FOLD_VERSION } from "../../shared/reportsContract";
import { makeFunctionReference } from "convex/server";
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./reports/"),
    loader,
  ]),
);
const NOW = Date.parse("2026-08-29T12:00:00Z");
const skuMetrics = {
  unitsSold: 1,
  unitsReturned: 0,
  grossSalesMinor: 10,
  netSalesMinor: 10,
  refundsMinor: 0,
  uncostedRevenueMinor: 0,
  grossProfitMinor: 4,
};
async function advance(
  t: TestConvex<typeof schema>,
  requestId: Id<"reportRangeResult">,
  now = NOW,
) {
  const row = await t.run((ctx) => ctx.db.get("reportRangeResult", requestId));
  if (!row) throw new Error("Missing request");
  await t.run((ctx) => dispatchSummaryRangesWithCtx(ctx, row.storeId, now));
  const claimRow = await t.run((ctx) =>
    ctx.db.get("reportRangeResult", requestId),
  );
  return t.run(async (ctx) => {
    const recorder = recordReadCosts(ctx);
    const result = await applySummaryRangeBatchWithCtx(
      recorder.ctx,
      { requestId, storeId: row.storeId, fence: claimRow?.summaryFence ?? 0 },
      now,
    );
    return { result, cost: recorder.snapshot() };
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("independent summary ranges", () => {
  it("keeps the full 366-day basis bounded and publishes every day", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC");
      const start = Date.parse("2025-08-29T00:00:00Z");
      for (let i = 0; i < 366; i++) {
        const operatingDate = new Date(start + i * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const inputId = await ctx.db.insert("reportRollupInput", {
          storeId: s.storeId,
          operatingDate,
          revision: 1,
          rowCount: 0,
          chunkCount: 0,
          digest: "fixture",
          createdAt: NOW,
        });
        await ctx.db.insert("reportRollupInputCurrent", {
          storeId: s.storeId,
          operatingDate,
          inputId,
          revision: 1,
        });
        await ctx.db.insert("reportDay", {
          storeId: s.storeId,
          operatingDate,
          ...skuMetrics,
          paymentsCollectedMinor: 0,
          paymentsRefundedMinor: 0,
          paymentAllocatedMinor: 0,
          currency: "GHS",
          status: "provisional",
          foldVersion: REPORTS_FOLD_VERSION,
          factCount: 1,
          lastFactRecordedAt: NOW,
          flags: {
            mixedCurrency: false,
            hasUncostedRevenue: false,
            quarantinedFactCount: 0,
          },
        });
      }
      await requestRangeCore(ctx, {
        storeId: s.storeId,
        startDate: "2025-08-29",
        endDate: "2026-08-29",
      });
      return {
        storeId: s.storeId,
        requestId: (await ctx.db.query("reportRangeResult").first())!._id,
      };
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(ids.storeId));
    let done = false;
    for (let i = 0; i < 375; i++) {
      const { result, cost } = await advance(t, ids.requestId);
      expect(cost.total.returnedDocuments).toBeLessThan(2000);
      expect(cost.total.serializedBytes).toBeLessThan(4 * 1024 * 1024);
      if (result === "done") {
        done = true;
        break;
      }
    }
    expect(done).toBe(true);
    expect(
      await t.run((ctx) => ctx.db.get("reportRangeResult", ids.requestId)),
    ).toMatchObject({
      status: "completed",
      totals: { dayCount: 366, netSalesMinor: 3660 },
    });
  });
  it("records a thrown poison request separately and completes a healthy sibling", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC");
      const inputId = await ctx.db.insert("reportRollupInput", {
        storeId: s.storeId,
        operatingDate: "2026-08-01",
        revision: 1,
        rowCount: 0,
        chunkCount: 0,
        digest: "fixture",
        createdAt: NOW,
      });
      for (let i = 0; i < 2; i++)
        await ctx.db.insert("reportRollupInputCurrent", {
          storeId: s.storeId,
          operatingDate: "2026-08-01",
          inputId,
          revision: 1,
        });
      await requestRangeCore(ctx, {
        storeId: s.storeId,
        startDate: "2026-08-01",
        endDate: "2026-08-01",
      });
      const poison = (await ctx.db.query("reportRangeResult").first())!;
      await requestRangeCore(ctx, {
        storeId: s.storeId,
        startDate: "2026-08-02",
        endDate: "2026-08-02",
      });
      const rows = await ctx.db.query("reportRangeResult").take(3);
      return {
        storeId: s.storeId,
        poisonId: poison._id,
        healthyId: rows.find((row) => row._id !== poison._id)!._id,
      };
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(ids.storeId));
    await t.run((ctx) => dispatchSummaryRangesWithCtx(ctx, ids.storeId, NOW));
    const poison = await t.run((ctx) =>
      ctx.db.get("reportRangeResult", ids.poisonId),
    );
    await t.action(
      makeFunctionReference<
        "action",
        {
          storeId: Id<"store">;
          requestId: Id<"reportRangeResult">;
          fence: number;
        }
      >("reports/pipelineRange:runSummaryBatch"),
      {
        storeId: ids.storeId,
        requestId: ids.poisonId,
        fence: poison!.summaryFence!,
      },
    );
    expect(
      await t.run((ctx) => ctx.db.get("reportRangeResult", ids.poisonId)),
    ).toMatchObject({
      status: "pending",
      summaryClaimed: false,
      summaryAttempts: 1,
      summaryEligibleAt: NOW + 5000,
    });
    for (let i = 0; i < 8; i++)
      if ((await advance(t, ids.healthyId)).result === "done") break;
    expect(
      await t.run((ctx) => ctx.db.get("reportRangeResult", ids.healthyId)),
    ).toMatchObject({ status: "completed" });
    expect(
      (await t.run((ctx) => ctx.db.get("reportRangeResult", ids.poisonId)))
        ?.totals,
    ).toBeUndefined();
  });
  it("expires an in-flight request without publishing its private children", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC");
      await requestRangeCore(ctx, {
        storeId: s.storeId,
        startDate: "2026-08-01",
        endDate: "2026-08-01",
      });
      const row = (await ctx.db.query("reportRangeResult").first())!;
      for (let i = 0; i < 101; i++)
        await ctx.db.insert("reportRangeSummarySku", {
          storeId: s.storeId,
          rangeResultId: row._id,
          productSkuId: s.skuId,
          ...skuMetrics,
          revenueSortKey: -10,
        });
      await ctx.db.patch("reportRangeResult", row._id, { expiresAt: NOW + 1 });
      return { storeId: s.storeId, requestId: row._id };
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(ids.storeId));
    await t.run((ctx) => dispatchSummaryRangesWithCtx(ctx, ids.storeId, NOW));
    expect(
      await t.run((ctx) =>
        applySummaryRangeBatchWithCtx(ctx, { ...ids, fence: 1 }, NOW + 2),
      ),
    ).toBe("stale");
    expect(
      (await t.run((ctx) => ctx.db.get("reportRangeResult", ids.requestId)))
        ?.totals,
    ).toBeUndefined();
    expect(
      await t.run((ctx) =>
        cleanupSummaryRangeWithCtx(ctx, ids.requestId, NOW + 2),
      ),
    ).toBe(true);
    expect(
      await t.run((ctx) => ctx.db.get("reportRangeResult", ids.requestId)),
    ).toBeNull();
  });
  it("removes expired partial cleanup from live eligibility before its children finish draining", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC");
      await requestRangeCore(ctx, {
        storeId: s.storeId,
        startDate: "2026-08-01",
        endDate: "2026-08-01",
      });
      const expired = (await ctx.db.query("reportRangeResult").first())!;
      for (let i = 0; i < 201; i++)
        await ctx.db.insert("reportRangeSummarySku", {
          storeId: s.storeId,
          rangeResultId: expired._id,
          productSkuId: s.skuId,
          ...skuMetrics,
          revenueSortKey: -10,
        });
      await ctx.db.patch("reportRangeResult", expired._id, {
        expiresAt: NOW - 1,
      });
      await requestRangeCore(ctx, {
        storeId: s.storeId,
        startDate: "2026-08-02",
        endDate: "2026-08-02",
      });
      return { storeId: s.storeId, expiredId: expired._id };
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(ids.storeId));
    expect(
      await t.run((ctx) => dispatchSummaryRangesWithCtx(ctx, ids.storeId, NOW)),
    ).toBe(0);
    expect(
      await t.run((ctx) => ctx.db.get("reportRangeResult", ids.expiredId)),
    ).toMatchObject({ summaryEligibleAt: Number.MAX_SAFE_INTEGER });
    expect(
      await t.run((ctx) => dispatchSummaryRangesWithCtx(ctx, ids.storeId, NOW)),
    ).toBe(1);
  });
  it("selects quiet legacy work despite three older kinded pending headers", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const storeId = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC");
      for (let i = 0; i < 3; i++)
        await ctx.db.insert("reportRangeResult", {
          storeId: s.storeId,
          requestKey: `aaa:${i}`,
          kind: "sku_movement",
          startDate: "2026-08-01",
          endDate: "2026-08-01",
          status: "pending",
          requestedAt: NOW - 1,
          expiresAt: NOW + 100_000,
          foldVersion: REPORTS_FOLD_VERSION,
        });
      await ctx.db.insert("reportRangeResult", {
        storeId: s.storeId,
        requestKey: "legacy",
        startDate: "2026-08-01",
        endDate: "2026-08-01",
        status: "pending",
        requestedAt: NOW,
        expiresAt: NOW + 100_000,
        foldVersion: REPORTS_FOLD_VERSION,
      });
      return s.storeId;
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(storeId));
    expect(
      await t.run((ctx) => dispatchSummaryRangesWithCtx(ctx, storeId, NOW)),
    ).toBe(1);
    const rows = await t.run((ctx) =>
      ctx.db.query("reportRangeResult").take(5),
    );
    expect(
      rows
        .filter((row) => row.kind === "sku_movement")
        .every((row) => row.status === "pending"),
    ).toBe(true);
  });
  it("keeps partial aggregates private and refuses duplicate or foreign claims", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC");
      const other = await seedStore(ctx, "UTC");
      await requestRangeCore(ctx, {
        storeId: s.storeId,
        startDate: "2026-08-01",
        endDate: "2026-08-31",
      });
      const row = await ctx.db.query("reportRangeResult").first();
      if (!row) throw new Error("missing request");
      return {
        storeId: s.storeId,
        otherStoreId: other.storeId,
        requestId: row._id,
      };
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(ids.storeId));
    await t.run((ctx) => dispatchSummaryRangesWithCtx(ctx, ids.storeId, NOW));
    const claim = { requestId: ids.requestId, storeId: ids.storeId, fence: 1 };
    expect(
      await t.run((ctx) =>
        applySummaryRangeBatchWithCtx(
          ctx,
          { ...claim, storeId: ids.otherStoreId },
          NOW,
        ),
      ),
    ).toBe("stale");
    expect(
      await t.run((ctx) => applySummaryRangeBatchWithCtx(ctx, claim, NOW)),
    ).toBe("more");
    expect(
      await t.run((ctx) => applySummaryRangeBatchWithCtx(ctx, claim, NOW)),
    ).toBe("stale");
    const row = await t.run((ctx) =>
      ctx.db.get("reportRangeResult", ids.requestId),
    );
    expect(row?.status).toBe("pending");
    expect(row?.totals).toBeUndefined();
    expect(row?.topSkus).toBeUndefined();
  });
  it("resumes a wide SKU set within one-page budgets and publishes only the complete result", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const { storeId, requestId } = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC");
      const sku = await ctx.db.get("productSku", s.skuId);
      if (!sku) throw new Error("Missing SKU");
      for (let i = 0; i < 205; i++) {
        const skuId =
          i === 0
            ? s.skuId
            : await ctx.db.insert("productSku", {
                storeId: s.storeId,
                productId: sku.productId,
                images: [],
                inventoryCount: 0,
                quantityAvailable: 0,
                price: 10,
              });
        await ctx.db.insert("reportSkuDay", {
          storeId: s.storeId,
          operatingDate: "2026-08-01",
          productSkuId: skuId,
          ...skuMetrics,
        });
      }
      await ctx.db.insert("reportDay", {
        storeId: s.storeId,
        operatingDate: "2026-08-01",
        ...skuMetrics,
        unitsSold: 205,
        netSalesMinor: 2050,
        grossProfitMinor: 820,
        paymentsCollectedMinor: 0,
        paymentsRefundedMinor: 0,
        paymentAllocatedMinor: 0,
        currency: "GHS",
        status: "provisional",
        foldVersion: REPORTS_FOLD_VERSION,
        factCount: 205,
        lastFactRecordedAt: NOW,
        flags: {
          mixedCurrency: false,
          hasUncostedRevenue: false,
          quarantinedFactCount: 0,
        },
      });
      await requestRangeCore(ctx, {
        storeId: s.storeId,
        startDate: "2026-08-01",
        endDate: "2026-08-31",
      });
      const row = await ctx.db.query("reportRangeResult").first();
      return { storeId: s.storeId, requestId: row!._id };
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(storeId));
    let batches = 0,
      done = false;
    while (!done && batches++ < 12) {
      const { result, cost } = await advance(t, requestId);
      expect(cost.total.returnedDocuments).toBeLessThan(220);
      expect(cost.total.serializedBytes).toBeLessThan(4 * 1024 * 1024);
      expect(cost.byTable.dailyClose).toBeUndefined();
      done = result === "done";
      const row = await t.run((ctx) =>
        ctx.db.get("reportRangeResult", requestId),
      );
      if (!done) expect(row?.totals).toBeUndefined();
    }
    expect(done).toBe(true);
    expect(batches).toBeGreaterThan(4);
    const row = await t.run((ctx) =>
      ctx.db.get("reportRangeResult", requestId),
    );
    expect(row?.totals).toMatchObject({
      netSalesMinor: 2050,
      unitsSold: 205,
      grossProfitMinor: 820,
    });
    expect(row?.topSkus).toHaveLength(100);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("reportRangeSummarySku")
          .withIndex("by_rangeResultId_productSkuId", (q) =>
            q.eq("rangeResultId", requestId),
          )
          .take(206),
      ),
    ).toHaveLength(205);
  });
  it("restarts private accumulation when a canonical fold advances the source fence", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const { storeId, requestId, skuId } = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC");
      await requestRangeCore(ctx, {
        storeId: s.storeId,
        startDate: "2026-08-29",
        endDate: "2026-08-29",
      });
      const row = await ctx.db.query("reportRangeResult").first();
      const control = await ctx.db.query("reportPipelineControl").first();
      await ctx.db.patch("reportPipelineControl", control!._id, {
        mode: "active",
      });
      return { storeId: s.storeId, requestId: row!._id, skuId: s.skuId };
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(storeId));
    await advance(t, requestId);
    await t.run(async (ctx) => {
      await recordFacts(ctx, storeId, [
        {
          sourceDomain: "pos",
          sourceId: "range-concurrent-sale",
          lineId: "one",
          factKind: "sale",
          occurredAt: NOW - 1,
          currency: "GHS",
          grossAmountMinor: 10,
          netAmountMinor: 10,
          taxAmountMinor: 0,
          discountAmountMinor: 0,
          quantity: 1,
          productSkuId: skuId,
        },
      ]);
    });
    expect((await advance(t, requestId)).result).toBe("blocked");
    await t.run(async (ctx) => {
      const claim = await claimDayWorkWithCtx(ctx, storeId, NOW + 1);
      expect(claim).not.toBeNull();
      await processDayWorkWithCtx(ctx, claim!, NOW + 2);
    });
    for (let i = 0; i < 4; i++) {
      await advance(t, requestId, NOW + 6000);
      if (
        (await t.run((ctx) => ctx.db.get("reportRangeResult", requestId)))
          ?.summaryPhase === "cleaning"
      )
        break;
    }
    expect(
      await t.run((ctx) => ctx.db.get("reportRangeResult", requestId)),
    ).toMatchObject({ status: "pending", summaryPhase: "cleaning" });
    for (let i = 0; i < 8; i++) {
      if ((await advance(t, requestId, NOW + 6000)).result === "done") break;
    }
    const row = await t.run((ctx) =>
      ctx.db.get("reportRangeResult", requestId),
    );
    expect(row).toMatchObject({ status: "completed", summaryWatermark: 1 });
    expect(row?.totals).toMatchObject({
      dayCount: 1,
      netSalesMinor: 10,
      unitsSold: 1,
    });
    expect(row?.topSkus?.[0]).toMatchObject({
      productSkuId: skuId,
      netSalesMinor: 10,
    });
  });
  it("drains expired children before the header and permits a fresh identical request", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC");
      const args = {
        storeId: s.storeId,
        startDate: "2026-08-01",
        endDate: "2026-08-01",
      };
      const { requestKey } = await requestRangeCore(ctx, args);
      const row = await ctx.db.query("reportRangeResult").first();
      for (let i = 0; i < 101; i++)
        await ctx.db.insert("reportRangeSummarySku", {
          storeId: s.storeId,
          rangeResultId: row!._id,
          productSkuId: s.skuId,
          ...skuMetrics,
          revenueSortKey: -10,
        });
      await ctx.db.patch("reportRangeResult", row!._id, { expiresAt: NOW - 1 });
      await requestRangeCore(ctx, args);
      return { requestId: row!._id, storeId: s.storeId, requestKey };
    });
    expect(
      await t.run((ctx) => ctx.db.get("reportRangeResult", ids.requestId)),
    ).not.toBeNull();
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("reportRangeResult")
          .withIndex("by_storeId_requestKey", (q) =>
            q.eq("storeId", ids.storeId).eq("requestKey", ids.requestKey),
          )
          .unique(),
      ),
    ).toMatchObject({ status: "pending", kind: "custom_summary" });
    expect(
      await t.run((ctx) => cleanupSummaryRangeWithCtx(ctx, ids.requestId, NOW)),
    ).toBe(true);
    expect(
      await t.run((ctx) => ctx.db.get("reportRangeResult", ids.requestId)),
    ).toBeNull();
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("reportRangeSummarySku")
          .withIndex("by_rangeResultId_productSkuId", (q) =>
            q.eq("rangeResultId", ids.requestId),
          )
          .first(),
      ),
    ).toBeNull();
  });
  it("recovers a dropped lease without admitting its old claim and lets a healthy sibling progress", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC");
      await requestRangeCore(ctx, {
        storeId: s.storeId,
        startDate: "2026-08-01",
        endDate: "2026-08-01",
      });
      const row = await ctx.db.query("reportRangeResult").first();
      return { storeId: s.storeId, requestId: row!._id };
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(ids.storeId));
    expect(
      await t.run((ctx) => dispatchSummaryRangesWithCtx(ctx, ids.storeId, NOW)),
    ).toBe(1);
    await t.run((ctx) =>
      requestRangeCore(ctx, {
        storeId: ids.storeId,
        startDate: "2026-08-02",
        endDate: "2026-08-02",
      }),
    );
    expect(
      await t.run((ctx) => dispatchSummaryRangesWithCtx(ctx, ids.storeId, NOW)),
    ).toBe(1);
    expect(
      await t.run((ctx) => dispatchSummaryRangesWithCtx(ctx, ids.storeId, NOW)),
    ).toBe(0);
    expect(
      await t.run((ctx) =>
        dispatchSummaryRangesWithCtx(ctx, ids.storeId, NOW + 60001),
      ),
    ).toBe(1);
    expect(
      await t.run((ctx) =>
        applySummaryRangeBatchWithCtx(ctx, { ...ids, fence: 1 }, NOW + 60001),
      ),
    ).toBe("stale");
    const row = await t.run((ctx) =>
      ctx.db.get("reportRangeResult", ids.requestId),
    );
    expect(row?.summaryFence).toBe(2);
  });
  it("does not discard a historical range for unrelated current-day folds", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC");
      await requestRangeCore(ctx, {
        storeId: s.storeId,
        startDate: "2026-08-01",
        endDate: "2026-08-01",
      });
      const row = await ctx.db.query("reportRangeResult").first();
      return { storeId: s.storeId, requestId: row!._id };
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(ids.storeId));
    await advance(t, ids.requestId);
    await t.run(async (ctx) => {
      const control = await ctx.db.query("reportPipelineControl").first();
      await ctx.db.patch("reportPipelineControl", control!._id, {
        sourceWatermark: 1,
      });
      const inputId = await ctx.db.insert("reportRollupInput", {
        storeId: ids.storeId,
        operatingDate: "2026-08-29",
        revision: 1,
        chunkCount: 0,
        rowCount: 0,
        digest: "empty",
        createdAt: NOW,
      });
      await ctx.db.insert("reportRollupInputCurrent", {
        storeId: ids.storeId,
        operatingDate: "2026-08-29",
        revision: 1,
        inputId,
      });
    });
    for (let i = 0; i < 3; i++) await advance(t, ids.requestId);
    expect(
      await t.run((ctx) => ctx.db.get("reportRangeResult", ids.requestId)),
    ).toMatchObject({ status: "completed", summaryWatermark: 0 });
  });
  it("preserves a foreign child on expired-parent cleanup and records a bounded refusal", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC"),
        other = await seedStore(ctx, "UTC");
      const requestId = await ctx.db.insert("reportRangeResult", {
        storeId: s.storeId,
        requestKey: "expired-bad",
        startDate: "2026-08-01",
        endDate: "2026-08-01",
        status: "pending",
        kind: "custom_summary",
        requestedAt: 1,
        expiresAt: 2,
        foldVersion: REPORTS_FOLD_VERSION,
      });
      const childId = await ctx.db.insert("reportRangeSummarySku", {
        storeId: other.storeId,
        rangeResultId: requestId,
        productSkuId: other.skuId,
        ...skuMetrics,
        revenueSortKey: -10,
      });
      return { requestId, childId };
    });
    expect(
      await t.run((ctx) => cleanupSummaryRangeWithCtx(ctx, ids.requestId, NOW)),
    ).toBe(false);
    expect(
      await t.run((ctx) => ctx.db.get("reportRangeSummarySku", ids.childId)),
    ).not.toBeNull();
    expect(
      await t.run((ctx) => ctx.db.get("reportRangeResult", ids.requestId)),
    ).toMatchObject({ summaryCleanupBlocked: true });
  });
  it("cleans and reinitializes once after a control-fence change", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC");
      await requestRangeCore(ctx, {
        storeId: s.storeId,
        startDate: "2026-08-01",
        endDate: "2026-08-01",
      });
      const row = await ctx.db.query("reportRangeResult").first();
      return { storeId: s.storeId, requestId: row!._id };
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(ids.storeId));
    await advance(t, ids.requestId);
    await t.run(async (ctx) => {
      const control = await ctx.db.query("reportPipelineControl").first();
      await ctx.db.patch("reportPipelineControl", control!._id, {
        fence: control!.fence + 1,
      });
    });
    for (let i = 0; i < 8; i++) {
      if ((await advance(t, ids.requestId)).result === "done") break;
    }
    expect(
      await t.run((ctx) => ctx.db.get("reportRangeResult", ids.requestId)),
    ).toMatchObject({ status: "completed", summaryControlFence: 2 });
  });
});
