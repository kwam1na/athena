/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { weekPeriodKey } from "../../shared/reportsContract";
import {
  addDaysToDate,
  affectedPeriodKeys,
  aggregateSkuDays,
  isoWeekStart,
  periodDateRange,
  rebuildPeriodRollup,
  rebuildRollupsForDates,
} from "./rollups";

const modules = import.meta.glob("../**/*.ts");

describe("operating-date arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDaysToDate("2026-07-28", 1)).toBe("2026-07-29");
    expect(addDaysToDate("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysToDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysToDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("finds the Monday of an ISO week", () => {
    expect(isoWeekStart("2026-07-28")).toBe("2026-07-27"); // Tuesday -> Monday
    expect(isoWeekStart("2026-07-27")).toBe("2026-07-27"); // Monday -> itself
    expect(isoWeekStart("2026-07-26")).toBe("2026-07-20"); // Sunday -> prior Mon
  });
});

describe("periodDateRange", () => {
  it("covers exactly one day for a day key", () => {
    expect(periodDateRange("d:2026-07-28")).toEqual({
      startDate: "2026-07-28",
      endDate: "2026-07-28",
    });
  });

  it("covers Monday..Sunday for a week key", () => {
    expect(periodDateRange("w:2026-W31")).toEqual({
      startDate: "2026-07-27",
      endDate: "2026-08-02",
    });
  });

  it("round-trips against the contract's week key", () => {
    // Whatever week the contract assigns a date to, that week's range must
    // contain the date — otherwise rollups would aggregate a different week
    // than the one the key names.
    for (const date of [
      "2026-01-01",
      "2026-03-15",
      "2026-07-28",
      "2026-12-31",
      "2027-01-03",
    ]) {
      const range = periodDateRange(weekPeriodKey(date))!;
      expect(range.startDate <= date && date <= range.endDate).toBe(true);
    }
  });

  it("covers the whole calendar month for a month key", () => {
    expect(periodDateRange("m:2026-07")).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });
    expect(periodDateRange("m:2026-02")).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
    expect(periodDateRange("m:2024-02")?.endDate).toBe("2024-02-29");
  });

  it("declines keys this module does not own", () => {
    expect(periodDateRange("trailing30")).toBeNull();
    expect(periodDateRange("w:not-a-week")).toBeNull();
  });
});

describe("affectedPeriodKeys", () => {
  it("returns the day, week, and month key of each date, deduped", () => {
    expect(affectedPeriodKeys(["2026-07-28", "2026-07-28"])).toEqual([
      "d:2026-07-28",
      "m:2026-07",
      "w:2026-W31",
    ]);
    expect(affectedPeriodKeys(["2026-07-27", "2026-07-28"])).toHaveLength(4);
  });
});

describe("aggregateSkuDays", () => {
  const row = (
    productSkuId: string,
    overrides: Record<string, number | null> = {},
  ) =>
    ({
      productSkuId: productSkuId as Id<"productSku">,
      unitsSold: 1,
      unitsReturned: 0,
      grossSalesMinor: 100,
      netSalesMinor: 100,
      refundsMinor: 0,
      uncostedRevenueMinor: 0,
      grossProfitMinor: 40,
      ...overrides,
    }) as any;

  it("sums per SKU across days", () => {
    const result = aggregateSkuDays([row("sku-a"), row("sku-a"), row("sku-b")]);

    expect(result.get("sku-a")).toEqual({
      unitsSold: 2,
      unitsReturned: 0,
      grossSalesMinor: 200,
      netSalesMinor: 200,
      refundsMinor: 0,
      uncostedRevenueMinor: 0,
      grossProfitMinor: 80,
    });
    expect(result.get("sku-b")?.netSalesMinor).toBe(100);
  });

  it("nulls the period margin when any contributing day is uncosted", () => {
    const result = aggregateSkuDays([
      row("sku-a"),
      row("sku-a", { grossProfitMinor: null, uncostedRevenueMinor: 100 }),
    ]);

    expect(result.get("sku-a")?.grossProfitMinor).toBeNull();
    expect(result.get("sku-a")?.uncostedRevenueMinor).toBe(100);
  });
});

// ---------------------------------------------------------------------------

async function seedStoreWithSkus(t: ReturnType<typeof convexTest>, count = 2) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("athenaUser", {
      email: "rollups@example.test",
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: userId,
      name: "Rollups",
      slug: "rollups",
    });
    const storeId = await ctx.db.insert("store", {
      createdByUserId: userId,
      currency: "GHS",
      name: "Rollups",
      organizationId,
      slug: "rollups",
    });
    const categoryId = await ctx.db.insert("category", {
      name: "Wigs",
      slug: "wigs",
      storeId,
    });
    const subcategoryId = await ctx.db.insert("subcategory", {
      categoryId,
      name: "Lace",
      slug: "lace",
      storeId,
    });
    const productId = await ctx.db.insert("product", {
      availability: "live",
      categoryId,
      createdByUserId: userId,
      currency: "GHS",
      inventoryCount: 10,
      name: "Wig",
      organizationId,
      slug: "wig",
      storeId,
      subcategoryId,
    });

    const skuIds: Id<"productSku">[] = [];
    for (let index = 0; index < count; index += 1) {
      skuIds.push(
        await ctx.db.insert("productSku", {
          images: [],
          inventoryCount: 10,
          price: 100,
          productId,
          quantityAvailable: 10,
          sku: `SKU-${index}`,
          storeId,
        }),
      );
    }

    return { storeId, skuIds };
  });
}

async function insertSkuDay(
  t: ReturnType<typeof convexTest>,
  args: {
    storeId: Id<"store">;
    productSkuId: Id<"productSku">;
    operatingDate: string;
    unitsSold: number;
    netSalesMinor: number;
  },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("reportSkuDay", {
      storeId: args.storeId,
      productSkuId: args.productSkuId,
      operatingDate: args.operatingDate,
      unitsSold: args.unitsSold,
      unitsReturned: 0,
      grossSalesMinor: args.netSalesMinor,
      netSalesMinor: args.netSalesMinor,
      refundsMinor: 0,
      uncostedRevenueMinor: 0,
      grossProfitMinor: 0,
    });
  });
}

describe("rebuildPeriodRollup", () => {
  it("aggregates a week from its sku-day rows with descending sort keys", async () => {
    const t = convexTest(schema, modules);
    const { storeId, skuIds } = await seedStoreWithSkus(t);

    await insertSkuDay(t, {
      storeId,
      productSkuId: skuIds[0],
      operatingDate: "2026-07-27",
      unitsSold: 2,
      netSalesMinor: 200,
    });
    await insertSkuDay(t, {
      storeId,
      productSkuId: skuIds[0],
      operatingDate: "2026-07-28",
      unitsSold: 1,
      netSalesMinor: 100,
    });
    await insertSkuDay(t, {
      storeId,
      productSkuId: skuIds[1],
      operatingDate: "2026-07-28",
      unitsSold: 5,
      netSalesMinor: 50,
    });
    // Outside the week — must not leak in.
    await insertSkuDay(t, {
      storeId,
      productSkuId: skuIds[0],
      operatingDate: "2026-07-26",
      unitsSold: 9,
      netSalesMinor: 900,
    });

    await t.run(async (ctx) => {
      await rebuildPeriodRollup(ctx, storeId, "w:2026-W31");
    });

    const rollups = await t.run(async (ctx) =>
      ctx.db.query("reportPeriodSkuRollup").collect(),
    );

    expect(rollups).toHaveLength(2);
    const first = rollups.find((row) => row.productSkuId === skuIds[0])!;
    expect(first.netSalesMinor).toBe(300);
    expect(first.unitsSold).toBe(3);
    expect(first.revenueSortKey).toBe(-300);
    expect(first.unitsSortKey).toBe(-3);
  });

  it("is idempotent: rebuilding twice leaves identical rows", async () => {
    const t = convexTest(schema, modules);
    const { storeId, skuIds } = await seedStoreWithSkus(t, 1);

    await insertSkuDay(t, {
      storeId,
      productSkuId: skuIds[0],
      operatingDate: "2026-07-28",
      unitsSold: 1,
      netSalesMinor: 100,
    });

    await t.run(async (ctx) => {
      await rebuildRollupsForDates(ctx, storeId, ["2026-07-28"]);
    });
    const first = await t.run(async (ctx) =>
      ctx.db.query("reportPeriodSkuRollup").collect(),
    );

    await t.run(async (ctx) => {
      await rebuildRollupsForDates(ctx, storeId, ["2026-07-28"]);
    });
    const second = await t.run(async (ctx) =>
      ctx.db.query("reportPeriodSkuRollup").collect(),
    );

    // Same docs — same ids, not deleted-and-recreated.
    expect(second).toEqual(first);
    expect(first.map((row) => row.periodKey).sort()).toEqual([
      "d:2026-07-28",
      "m:2026-07",
      "w:2026-W31",
    ]);
  });

  it("drops SKUs that no longer have activity in the period", async () => {
    const t = convexTest(schema, modules);
    const { storeId, skuIds } = await seedStoreWithSkus(t);

    await insertSkuDay(t, {
      storeId,
      productSkuId: skuIds[0],
      operatingDate: "2026-07-28",
      unitsSold: 1,
      netSalesMinor: 100,
    });
    await insertSkuDay(t, {
      storeId,
      productSkuId: skuIds[1],
      operatingDate: "2026-07-28",
      unitsSold: 1,
      netSalesMinor: 100,
    });
    await t.run(async (ctx) => {
      await rebuildPeriodRollup(ctx, storeId, "d:2026-07-28");
    });

    // The second SKU's line was voided: its sku-day row disappears.
    await t.run(async (ctx) => {
      const stale = await ctx.db
        .query("reportSkuDay")
        .filter((q) => q.eq(q.field("productSkuId"), skuIds[1]))
        .unique();
      await ctx.db.delete(stale!._id);
      await rebuildPeriodRollup(ctx, storeId, "d:2026-07-28");
    });

    const rollups = await t.run(async (ctx) =>
      ctx.db.query("reportPeriodSkuRollup").collect(),
    );
    expect(rollups).toHaveLength(1);
    expect(rollups[0].productSkuId).toBe(skuIds[0]);
  });
});
