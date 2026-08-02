/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  REPORTS_FOLD_VERSION,
  type NewReportFact,
} from "../../shared/reportsContract";
import { factFingerprint, LEGACY_REPORTS_FINGERPRINT_VERSION } from "./fingerprint";
import { recordFacts } from "./ingest";

const modules = import.meta.glob("../**/*.ts");

/** All tests pin "now" so the current operating day is deterministic. */
const NOW = Date.parse("2026-03-10T12:00:00Z");
const TODAY = "2026-03-10";
const YESTERDAY = "2026-03-09";

type Seeded = {
  organizationId: Id<"organization">;
  storeId: Id<"store">;
  userId: Id<"athenaUser">;
  skuId: Id<"productSku">;
  otherSkuId: Id<"productSku">;
};

async function seed(ctx: MutationCtx, timezone?: string): Promise<Seeded> {
  const userId = await ctx.db.insert("athenaUser", {
    email: "admin@example.test",
  });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: userId,
    name: "Org",
    slug: "org",
  });
  const storeId = await ctx.db.insert("store", {
    ...(timezone ? { config: { timezone } } : {}),
    createdByUserId: userId,
    currency: "GHS",
    name: "Store",
    organizationId,
    slug: "store",
  });
  const categoryId = await ctx.db.insert("category", {
    name: "Category",
    slug: "category",
    storeId,
  });
  const subcategoryId = await ctx.db.insert("subcategory", {
    categoryId,
    name: "Subcategory",
    slug: "subcategory",
    storeId,
  });
  const productId = await ctx.db.insert("product", {
    availability: "live",
    categoryId,
    createdByUserId: userId,
    currency: "GHS",
    inventoryCount: 0,
    name: "Product",
    organizationId,
    slug: "product",
    storeId,
    subcategoryId,
  });
  const insertSku = (sku: string) =>
    ctx.db.insert("productSku", {
      attributes: {},
      images: [],
      inventoryCount: 0,
      price: 100,
      productId,
      quantityAvailable: 0,
      sku,
      storeId,
    });
  const skuId = await insertSku("SKU-A");
  const otherSkuId = await insertSku("SKU-B");
  return { organizationId, otherSkuId, skuId, storeId, userId };
}

function saleFact(overrides: Partial<NewReportFact> = {}): NewReportFact {
  return {
    sourceDomain: "pos",
    sourceId: "txn_1",
    lineId: "line_1",
    factKind: "sale",
    occurredAt: NOW - 60_000,
    currency: "GHS",
    grossAmountMinor: 10_000,
    netAmountMinor: 9_000,
    taxAmountMinor: 500,
    discountAmountMinor: 1_000,
    quantity: 2,
    ...overrides,
  };
}

async function readDay(ctx: MutationCtx, storeId: Id<"store">, date: string) {
  return await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", date),
    )
    .unique();
}

async function readDirty(ctx: MutationCtx, storeId: Id<"store">) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
  const rows = await ctx.db
    .query("reportDirtyDay")
    .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
    .collect();
  return rows.map((row) => ({
    operatingDate: row.operatingDate,
    reason: row.reason,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordFacts — identity and replay", () => {
  it("inserts a fact with fingerprint, operating date and arrival time", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { skuId, storeId } = await seed(ctx);
      await recordFacts(ctx, storeId, [saleFact({ productSkuId: skuId })]);

      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const facts = await ctx.db.query("reportFact").collect();
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({
        factKind: "sale",
        fingerprintVersion: 2,
        lineId: "line_1",
        operatingDate: TODAY,
        observedAt: NOW,
        recordedAt: NOW,
        sourceDomain: "pos",
        sourceId: "txn_1",
        taxAmountMinor: 500,
      });
      expect(facts[0].fingerprint).toMatch(/^v2:[0-9a-f]{8}$/);
      expect(facts[0].quarantine).toBeUndefined();
    });
  });

  it("treats an identical replay as a no-op", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { skuId, storeId } = await seed(ctx);
      const fact = saleFact({ productSkuId: skuId });
      await recordFacts(ctx, storeId, [fact]);
      await recordFacts(ctx, storeId, [fact]);

      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      expect(await ctx.db.query("reportFact").collect()).toHaveLength(1);
      const day = await readDay(ctx, storeId, TODAY);
      // The replay must not double-count the open day either.
      expect(day).toMatchObject({ factCount: 1, netSalesMinor: 9_000 });
    });
  });

  it("replays a legacy payment fact under its stored fingerprint version", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { storeId } = await seed(ctx);
      const payment = saleFact({
        sourceDomain: "payments",
        sourceId: "allocation_legacy",
        lineId: "",
        factKind: "payment",
        grossAmountMinor: 2_000,
        netAmountMinor: 2_000,
        quantity: 0,
      });
      const { productSkuId: _productSkuId, ...legacyPayment } = payment;
      await ctx.db.insert("reportFact", {
        ...legacyPayment,
        fingerprint: factFingerprint(payment, LEGACY_REPORTS_FINGERPRINT_VERSION),
        fingerprintVersion: LEGACY_REPORTS_FINGERPRINT_VERSION,
        operatingDate: TODAY,
        recordedAt: NOW,
        storeId,
      });

      await recordFacts(ctx, storeId, [
        {
          ...payment,
          paymentAllocationCoverage: "known",
          paymentAllocationMinor: 2_000,
        },
      ]);

      // The new fields are intentionally ignored for v1 identity comparison;
      // routine replay never upgrades or quarantines historical lineage.
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const facts = await ctx.db.query("reportFact").collect();
      expect(facts).toHaveLength(1);
      expect(facts[0].quarantine).toBeUndefined();
      expect(facts[0].paymentAllocationCoverage).toBeUndefined();
    });
  });

  it("quarantines the stored fact on content conflict instead of overwriting", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { skuId, storeId } = await seed(ctx);
      await recordFacts(ctx, storeId, [saleFact({ productSkuId: skuId })]);
      await recordFacts(ctx, storeId, [
        saleFact({ netAmountMinor: 4_000, productSkuId: skuId }),
      ]);

      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const facts = await ctx.db.query("reportFact").collect();
      expect(facts).toHaveLength(1);
      // Original content survives; the conflict is parked, not applied.
      expect(facts[0].netAmountMinor).toBe(9_000);
      expect(facts[0].quarantine).toEqual({
        detectedAt: NOW,
        reason: "content_conflict",
      });
      const day = await readDay(ctx, storeId, TODAY);
      expect(day).toMatchObject({ factCount: 1, netSalesMinor: 9_000 });
    });
  });

  it("dirties the conflicting fact's own day when it is not today", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { storeId } = await seed(ctx);
      const late = saleFact({ occurredAt: Date.parse("2026-03-09T10:00:00Z") });

      vi.spyOn(Date, "now").mockReturnValue(NOW);
      await recordFacts(ctx, storeId, [late]);
      await recordFacts(ctx, storeId, [{ ...late, quantity: 5 }]);

      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const facts = await ctx.db.query("reportFact").collect();
      expect(facts[0].quarantine?.reason).toBe("content_conflict");
      expect(await readDirty(ctx, storeId)).toEqual(
        expect.arrayContaining([
          { operatingDate: YESTERDAY, reason: "late_fact" },
          { operatingDate: TODAY, reason: "day_open" },
        ]),
      );
    });
  });
});

describe("recordFacts — open-day incremental math", () => {
  it("accumulates sales, refunds and payments across a batch", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { skuId, storeId } = await seed(ctx);
      await recordFacts(ctx, storeId, [
        saleFact({ productSkuId: skuId, unitCostMinor: 2_000 }),
        saleFact({
          grossAmountMinor: 5_000,
          lineId: "line_2",
          netAmountMinor: 5_000,
          productSkuId: skuId,
          quantity: 1,
          unitCostMinor: 2_000,
        }),
        {
          ...saleFact(),
          factKind: "refund",
          lineId: "line_1",
          netAmountMinor: 3_000,
          grossAmountMinor: 3_000,
          productSkuId: skuId,
          quantity: 1,
          sourceId: "txn_1_refund",
          unitCostMinor: 2_000,
        },
        {
          ...saleFact(),
          factKind: "payment",
          lineId: "",
          netAmountMinor: 14_000,
          grossAmountMinor: 14_000,
          productSkuId: undefined,
          quantity: 0,
          sourceId: "pay_1",
          paymentAllocationCoverage: "known",
          paymentAllocationMinor: 14_000,
        },
      ]);

      const day = await readDay(ctx, storeId, TODAY);
      expect(day).toMatchObject({
        currency: "GHS",
        factCount: 4,
        foldVersion: REPORTS_FOLD_VERSION,
        grossSalesMinor: 15_000,
        lastFactRecordedAt: NOW,
        netSalesMinor: 11_000,
        paymentAllocatedMinor: 14_000,
        paymentsCollectedMinor: 14_000,
        paymentsRefundedMinor: 0,
        refundsMinor: 3_000,
        status: "open",
        unitsReturned: 1,
        // Gross units sold — returns live in unitsReturned, they do not
        // subtract here (matches foldDay).
        unitsSold: 3,
      });
      expect(day?.foldedAt).toBeUndefined();
      // 9000-4000 + 5000-2000 + (-3000+2000)
      expect(day?.grossProfitMinor).toBe(7_000);
      expect(day?.flags).toEqual({
        hasUncostedRevenue: false,
        mixedCurrency: false,
        quarantinedFactCount: 0,
      });
      expect(day?.paymentPosture).toMatchObject({
        allocationCoverage: "complete",
        unsettledMinor: 0,
      });

      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const skuDays = await ctx.db.query("reportSkuDay").collect();
      expect(skuDays).toHaveLength(1);
      expect(skuDays[0]).toMatchObject({
        grossProfitMinor: 7_000,
        grossSalesMinor: 15_000,
        netSalesMinor: 11_000,
        operatingDate: TODAY,
        productSkuId: skuId,
        refundsMinor: 3_000,
        unitsReturned: 1,
        unitsSold: 3,
      });
    });
  });

  it("upserts one sku-day row per sku and merges across calls", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { otherSkuId, skuId, storeId } = await seed(ctx);
      await recordFacts(ctx, storeId, [
        saleFact({ productSkuId: skuId, unitCostMinor: 1_000 }),
        saleFact({
          lineId: "line_2",
          productSkuId: otherSkuId,
          unitCostMinor: 1_000,
        }),
      ]);
      await recordFacts(ctx, storeId, [
        saleFact({
          lineId: "line_3",
          productSkuId: skuId,
          sourceId: "txn_2",
          unitCostMinor: 1_000,
        }),
      ]);

      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const skuDays = await ctx.db.query("reportSkuDay").collect();
      expect(skuDays).toHaveLength(2);
      const bySku = new Map(skuDays.map((row) => [row.productSkuId, row]));
      expect(bySku.get(skuId)).toMatchObject({
        netSalesMinor: 18_000,
        unitsSold: 4,
      });
      expect(bySku.get(otherSkuId)).toMatchObject({
        netSalesMinor: 9_000,
        unitsSold: 2,
      });
      expect(await readDay(ctx, storeId, TODAY)).toMatchObject({
        factCount: 3,
        netSalesMinor: 27_000,
      });
    });
  });

  it("nulls gross profit and flags uncosted revenue when a cost basis is missing", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { skuId, storeId } = await seed(ctx);
      await recordFacts(ctx, storeId, [
        saleFact({ productSkuId: skuId, unitCostMinor: 2_000 }),
        saleFact({ lineId: "line_2", productSkuId: skuId }),
      ]);

      const day = await readDay(ctx, storeId, TODAY);
      expect(day?.grossProfitMinor).toBeNull();
      expect(day?.uncostedRevenueMinor).toBe(9_000);
      expect(day?.flags.hasUncostedRevenue).toBe(true);
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const skuDays = await ctx.db.query("reportSkuDay").collect();
      expect(skuDays[0].grossProfitMinor).toBeNull();
      expect(skuDays[0].uncostedRevenueMinor).toBe(9_000);
    });
  });

  it("flags foreign-currency facts and keeps them out of totals", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { storeId } = await seed(ctx);
      await recordFacts(ctx, storeId, [
        saleFact({ unitCostMinor: 1_000 }),
        saleFact({ currency: "USD", lineId: "line_2" }),
      ]);

      const day = await readDay(ctx, storeId, TODAY);
      expect(day).toMatchObject({ factCount: 2, netSalesMinor: 9_000 });
      expect(day?.flags.mixedCurrency).toBe(true);
    });
  });

  it("records non-revenue kinds without moving day metrics", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { storeId } = await seed(ctx);
      await recordFacts(ctx, storeId, [
        {
          ...saleFact(),
          factKind: "close_snapshot",
          lineId: "",
          sourceDomain: "daily_close",
          sourceId: "close_1",
        },
      ]);

      const day = await readDay(ctx, storeId, TODAY);
      expect(day).toMatchObject({
        factCount: 1,
        grossSalesMinor: 0,
        netSalesMinor: 0,
      });
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      expect(await ctx.db.query("reportFact").collect()).toHaveLength(1);
    });
  });
});

describe("recordFacts — day routing", () => {
  it("dirties a late fact's day instead of patching it", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { skuId, storeId } = await seed(ctx);
      await recordFacts(ctx, storeId, [
        saleFact({
          occurredAt: Date.parse("2026-03-09T10:00:00Z"),
          productSkuId: skuId,
        }),
      ]);

      expect(await readDay(ctx, storeId, YESTERDAY)).toBeNull();
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      expect(await ctx.db.query("reportSkuDay").collect()).toHaveLength(0);
      expect(await readDirty(ctx, storeId)).toEqual(
        expect.arrayContaining([
          { operatingDate: YESTERDAY, reason: "late_fact" },
          { operatingDate: TODAY, reason: "day_open" },
        ]),
      );
      // The fact itself is still stored, dated to its own operating day.
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const facts = await ctx.db.query("reportFact").collect();
      expect(facts[0].operatingDate).toBe(YESTERDAY);
    });
  });

  it("routes by store-local day, not UTC, across a non-UTC midnight", async () => {
    // "Now" (2026-03-10T12:00Z) is 21:00 on 2026-03-10 in Tokyo (UTC+9), so the
    // current operating day is 2026-03-10. The two facts below straddle the
    // LOCAL midnights, and UTC would route both of them to the wrong day:
    //   2026-03-09T16:00Z = 2026-03-10 01:00 local → current day (UTC says 03-09)
    //   2026-03-10T16:00Z = 2026-03-11 01:00 local → other day  (UTC says 03-10)
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { storeId } = await seed(ctx, "Asia/Tokyo");
      await recordFacts(ctx, storeId, [
        saleFact({
          occurredAt: Date.parse("2026-03-09T16:00:00Z"),
          unitCostMinor: 1_000,
        }),
        saleFact({
          lineId: "line_2",
          occurredAt: Date.parse("2026-03-10T16:00:00Z"),
          unitCostMinor: 1_000,
        }),
      ]);

      expect(await readDay(ctx, storeId, "2026-03-10")).toMatchObject({
        factCount: 1,
        netSalesMinor: 9_000,
      });
      expect(await readDay(ctx, storeId, "2026-03-09")).toBeNull();
      expect(await readDay(ctx, storeId, "2026-03-11")).toBeNull();

      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const facts = await ctx.db.query("reportFact").collect();
      expect(
        facts.map((row) => [row.lineId, row.operatingDate]).sort(),
      ).toEqual([
        ["line_1", "2026-03-10"],
        ["line_2", "2026-03-11"],
      ]);
      expect(await readDirty(ctx, storeId)).toEqual(
        expect.arrayContaining([
          { operatingDate: "2026-03-11", reason: "late_fact" },
          { operatingDate: "2026-03-10", reason: "day_open" },
        ]),
      );
    });
  });

  it("always leaves a standing day_open mark, even for an empty-effect batch", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { storeId } = await seed(ctx);
      const fact = saleFact();
      await recordFacts(ctx, storeId, [fact]);
      await recordFacts(ctx, storeId, [fact]); // pure replay

      const dirty = await readDirty(ctx, storeId);
      expect(dirty).toEqual([{ operatingDate: TODAY, reason: "day_open" }]);
    });
  });

  it("does nothing at all for an empty fact list", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { storeId } = await seed(ctx);
      await recordFacts(ctx, storeId, []);
      expect(await readDirty(ctx, storeId)).toEqual([]);
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      expect(await ctx.db.query("reportDay").collect()).toHaveLength(0);
    });
  });
});

describe("recordFacts — containment", () => {
  /** ctx whose writes to a chosen table explode, everything else intact. */
  function brokenCtx(ctx: MutationCtx, table: string): MutationCtx {
    const db = ctx.db;
    return {
      ...ctx,
      db: {
        ...db,
        get: db.get.bind(db),
        query: db.query.bind(db),
        insert: (name: string, doc: unknown) => {
          if (name === table) throw new Error(`injected ${table} write failure`);
          return (db.insert as (n: string, d: unknown) => unknown)(name, doc);
        },
        patch: db.patch.bind(db),
        delete: db.delete.bind(db),
        replace: db.replace.bind(db),
      },
    } as unknown as MutationCtx;
  }

  it("marks write_failure and returns normally when the fact write fails", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { storeId } = await seed(ctx);
      await expect(
        recordFacts(brokenCtx(ctx, "reportFact"), storeId, [saleFact()]),
      ).resolves.toBeUndefined();

      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      expect(await ctx.db.query("reportFact").collect()).toHaveLength(0);
      expect(await readDirty(ctx, storeId)).toEqual([
        { operatingDate: TODAY, reason: "write_failure" },
      ]);
    });
  });

  it("marks write_failure for the day docs it could not patch", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { skuId, storeId } = await seed(ctx);
      await expect(
        recordFacts(brokenCtx(ctx, "reportDay"), storeId, [
          saleFact({ productSkuId: skuId }),
        ]),
      ).resolves.toBeUndefined();

      // The fact landed; only the derived preview failed — exactly what the
      // dirty mark tells the sweeper to rebuild.
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      expect(await ctx.db.query("reportFact").collect()).toHaveLength(1);
      expect(await readDirty(ctx, storeId)).toEqual([
        { operatingDate: TODAY, reason: "write_failure" },
      ]);
    });
  });

  it("marks every date the failed batch touched", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { storeId } = await seed(ctx);
      await expect(
        recordFacts(brokenCtx(ctx, "reportFact"), storeId, [
          saleFact({ occurredAt: Date.parse("2026-03-09T10:00:00Z") }),
        ]),
      ).resolves.toBeUndefined();

      expect(await readDirty(ctx, storeId)).toEqual(
        expect.arrayContaining([
          { operatingDate: TODAY, reason: "write_failure" },
          { operatingDate: YESTERDAY, reason: "write_failure" },
        ]),
      );
    });
  });

  it("lets the domain transaction abort when even the dirty mark cannot be written", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { storeId } = await seed(ctx);
      const doubleBroken = brokenCtx(
        brokenCtx(ctx, "reportFact"),
        "reportDirtyDay",
      );
      await expect(
        recordFacts(doubleBroken, storeId, [saleFact()]),
      ).rejects.toThrow(/injected reportDirtyDay write failure/);
    });
  });
});
