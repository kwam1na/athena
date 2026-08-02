/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeFunctionReference } from "convex/server";

import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  RESEED_PURGE_TABLES,
  normalizeReseedCursor,
  reseedStep,
  type ReseedCursor,
} from "./reseed";
import { rebuildCurrentWeek } from "./weekly";
import {
  seedDailyClose,
  seedOnlineOrder,
  seedPaymentAllocation,
  seedPosCorrection,
  seedPosSale,
  seedReceivingBatch,
  seedServiceCase,
  seedStore,
  type SeededStore,
} from "./reseedTestSupport";

/**
 * Module map rooted at `convex/`, so function references resolve by their
 * deployed path (`reports/reseed:reseedStoreReporting`). The plain
 * `import.meta.glob("../**\/*.ts")` used by the read-only suites is enough to
 * import helpers, but not to call a registered function by reference.
 */
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./reports/"),
    loader,
  ]),
);

/** Pinned "now" so the current operating day is deterministic. */
const NOW = Date.parse("2026-03-10T12:00:00Z");
const DAY1 = "2026-03-05";
const at = (time: string) => Date.parse(`${DAY1}T${time}:00Z`);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Harness = ReturnType<typeof convexTest>;

/**
 * Referenced by path for the same reason `reseed.ts` schedules itself by path:
 * `_generated/api.d.ts` predates this module. See RESEED_SELF_REF there.
 */
const RESEED_MUTATION = makeFunctionReference<
  "mutation",
  { cursor?: ReseedCursor; storeId: Id<"store"> }
>("reports/reseed:reseedStoreReporting");

/**
 * Drive the phase machine to completion.
 *
 * Each step runs in its OWN mutation execution, because Convex allows one
 * `.paginate()` per execution — which is exactly the shape production gets,
 * where every step is a separately scheduled `reseedStoreReporting` call.
 * Driving the loop inside a single `t.run` would test a topology that cannot
 * exist on a deployed backend.
 */
async function runReseed(
  t: Harness,
  storeId: Id<"store">,
  options: { maxSteps?: number; stopAfter?: number } = {},
): Promise<{ cursor: ReseedCursor | null; steps: number }> {
  const maxSteps = options.maxSteps ?? 300;
  let cursor = normalizeReseedCursor(undefined);
  let steps = 0;

  while (steps < maxSteps) {
    const progress = await t.run(async (ctx: MutationCtx) =>
      reseedStep(ctx, storeId, cursor),
    );
    steps += 1;
    if (progress.cursor === null) return { cursor: null, steps };
    cursor = progress.cursor;
    if (options.stopAfter !== undefined && steps >= options.stopAfter) {
      return { cursor, steps };
    }
  }
  throw new Error(`reseed did not terminate within ${maxSteps} steps`);
}

/** Continue a reseed from a serialized cursor, as a scheduled retry would. */
async function resumeReseed(
  t: Harness,
  storeId: Id<"store">,
  from: ReseedCursor,
): Promise<void> {
  let cursor = from;
  for (let step = 0; step < 300; step += 1) {
    const progress = await t.run(async (ctx: MutationCtx) =>
      reseedStep(ctx, storeId, cursor),
    );
    if (progress.cursor === null) return;
    cursor = progress.cursor;
  }
  throw new Error("resumed reseed did not terminate");
}

/** Stable, id-free projection of the fact ledger for equality assertions. */
async function factSignature(t: Harness): Promise<string[]> {
  return await t.run(async (ctx: MutationCtx) => {
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
    const facts = await ctx.db.query("reportFact").collect();
    return facts
      .map((fact) =>
        [
          fact.sourceDomain,
          fact.sourceId,
          fact.lineId,
          fact.factKind,
          fact.operatingDate,
          fact.occurredAt,
          fact.grossAmountMinor,
          fact.netAmountMinor,
          fact.quantity,
          fact.fingerprint,
        ].join("|"),
      )
      .sort();
  });
}

/** A day's worth of activity across every domain the walker covers. */
async function seedFullDay(ctx: MutationCtx): Promise<SeededStore> {
  const seeded = await seedStore(ctx);

  await seedPosSale(ctx, seeded, {
    completedAt: at("10:00"),
    lines: [{ quantity: 2, unitPrice: 5_000 }],
    tax: 500,
    transactionNumber: "T-1",
  });
  await seedOnlineOrder(ctx, seeded, {
    completedAt: at("11:00"),
    deliveryFee: 1_000,
    discountTotal: 500,
    items: [{ price: 3_000, quantity: 1 }],
    orderNumber: "O-1",
    refunds: [{ amount: 1_000, date: at("15:00"), id: "rf1" }],
  });
  await seedServiceCase(ctx, seeded, {
    completedAt: at("12:00"),
    lines: [{ amount: 4_000, quantity: 1 }],
  });
  await seedPaymentAllocation(ctx, seeded, {
    amount: 9_000,
    recordedAt: at("13:00"),
    targetId: "T-1",
  });
  await seedPaymentAllocation(ctx, seeded, {
    amount: 1_000,
    direction: "out",
    recordedAt: at("13:30"),
    targetId: "O-1",
  });
  await seedReceivingBatch(ctx, seeded, {
    confirmedUnitCost: 200,
    receivedAt: at("14:00"),
    receivedQuantity: 5,
    unitCost: 200,
  });
  await seedDailyClose(ctx, seeded, {
    completedAt: at("20:00"),
    operatingDate: DAY1,
    salesTotal: 17_000,
  });

  return seeded;
}

describe("reseed — fact reconstruction", () => {
  it("does not accept caller-supplied observation time", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    const invokeWithInvalidArgs = t.mutation as unknown as (
      reference: typeof RESEED_MUTATION,
      args: unknown,
    ) => Promise<unknown>;

    await expect(
      invokeWithInvalidArgs(RESEED_MUTATION, {
        observedAt: 1,
        storeId: seeded.storeId,
      }),
    ).rejects.toThrow();
  });

  it("rebuilds one fact per domain line with structural identity", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedFullDay);
    await runReseed(t, seeded.storeId);

    await t.run(async (ctx) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const facts = await ctx.db.query("reportFact").collect();
      const byKind = facts.reduce<Record<string, number>>((counts, fact) => {
        const key = `${fact.sourceDomain}:${fact.factKind}`;
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {});

      expect(byKind).toEqual({
        // POS: one merchandise line + the header tax line.
        "pos:sale": 2,
        // Storefront: one merchandise line + delivery, then one refund line.
        "storefront:sale": 2,
        "storefront:refund": 1,
        "service:sale": 1,
        "payments:payment": 1,
        "payments:payment_refund": 1,
        "inventory:procurement_receipt": 1,
        "daily_close:close_snapshot": 1,
      });

      // Every fact is dated to the day its business event happened on, never
      // to the day the reseed ran.
      expect(new Set(facts.map((fact) => fact.operatingDate))).toEqual(
        new Set([DAY1]),
      );
      // Reseed stamps business time as recordedAt so re-derived facts don't
      // postdate their day's close (which would fold every day `amended`).
      expect(facts.every((fact) => fact.recordedAt === fact.occurredAt)).toBe(
        true,
      );
      expect(facts.every((fact) => fact.observedAt === NOW)).toBe(true);
      expect(facts.every((fact) => fact.quarantine === undefined)).toBe(true);
      expect(
        facts
          .filter((fact) => fact.sourceDomain === "payments")
          .map((fact) => ({
            factKind: fact.factKind,
            paymentAllocationCoverage: fact.paymentAllocationCoverage,
            paymentAllocationMinor: fact.paymentAllocationMinor,
          })),
      ).toEqual([
        {
          factKind: "payment",
          paymentAllocationCoverage: "known",
          paymentAllocationMinor: 9_000,
        },
        {
          factKind: "payment_refund",
          paymentAllocationCoverage: "known",
          paymentAllocationMinor: -1_000,
        },
      ]);
    });
  });

  it("reconstructs a timed void and leaves a legacy void coverage-unknown", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await ctx.db.insert("paymentAllocation", {
        allocationType: "retail_sale",
        amount: 2_500,
        collectedInStore: true,
        currency: "GHS",
        direction: "in",
        method: "cash",
        organizationId: store.organizationId,
        recordedAt: at("09:00"),
        status: "voided",
        storeId: store.storeId,
        targetId: "timed",
        targetType: "pos_transaction",
        voidedAt: at("10:00"),
      });
      await ctx.db.insert("paymentAllocation", {
        allocationType: "retail_sale",
        amount: 1_000,
        collectedInStore: true,
        currency: "GHS",
        direction: "in",
        method: "cash",
        organizationId: store.organizationId,
        recordedAt: at("11:00"),
        status: "voided",
        storeId: store.storeId,
        targetId: "legacy",
        targetType: "pos_transaction",
      });
      return store;
    });

    await runReseed(t, seeded.storeId);
    await t.run(async (ctx) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const payments = (await ctx.db.query("reportFact").collect())
        .filter((fact) => fact.sourceDomain === "payments")
        .sort((left, right) => left.occurredAt - right.occurredAt);
      expect(
        payments.map((fact) => ({
          factKind: fact.factKind,
          occurredAt: fact.occurredAt,
          coverage: fact.paymentAllocationCoverage,
          allocated: fact.paymentAllocationMinor,
        })),
      ).toEqual([
        {
          factKind: "payment",
          occurredAt: at("09:00"),
          coverage: "known",
          allocated: 2_500,
        },
        {
          factKind: "payment_refund",
          occurredAt: at("10:00"),
          coverage: "known",
          allocated: -2_500,
        },
        {
          factKind: "payment",
          occurredAt: at("11:00"),
          coverage: "unknown",
          allocated: undefined,
        },
      ]);
    });
  });

  it("keeps the tax line separate so POS net sales reconcile to the header", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await seedPosSale(ctx, store, {
        completedAt: at("10:00"),
        lines: [{ quantity: 2, unitPrice: 5_000 }],
        tax: 500,
        transactionNumber: "T-1",
      });
      return store;
    });
    await runReseed(t, seeded.storeId);

    await t.run(async (ctx) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const facts = await ctx.db.query("reportFact").collect();
      expect(facts.find((fact) => fact.lineId === "tax")).toMatchObject({
        grossAmountMinor: 500,
        netAmountMinor: 500,
        quantity: 0,
        taxAmountMinor: 500,
      });
      expect(facts.find((fact) => fact.lineId !== "tax")).toMatchObject({
        grossAmountMinor: 10_000,
        netAmountMinor: 10_000,
        quantity: 2,
      });
      const net = facts.reduce((sum, fact) => sum + fact.netAmountMinor, 0);
      expect(net).toBe(10_500);
    });
  });

  it("dates a void to voidedAt while the sale keeps its own day", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await seedPosSale(ctx, store, {
        completedAt: at("10:00"),
        lines: [{ quantity: 1, unitPrice: 5_000 }],
        status: "void",
        transactionNumber: "T-VOID",
        voidedAt: Date.parse("2026-03-06T09:00:00Z"),
      });
      return store;
    });
    await runReseed(t, seeded.storeId);

    await t.run(async (ctx) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const facts = await ctx.db.query("reportFact").collect();
      const sale = facts.find((fact) => fact.factKind === "sale");
      const voided = facts.find((fact) => fact.factKind === "void");
      expect(sale?.operatingDate).toBe(DAY1);
      expect(voided?.operatingDate).toBe("2026-03-06");
      // Same line, different kind — identity is the composite, so both coexist.
      expect(sale?.lineId).toBe(voided?.lineId);
    });
  });

  it("signs a correction as a delta rather than a magnitude", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      const transactionId = await seedPosSale(ctx, store, {
        completedAt: at("10:00"),
        lines: [{ quantity: 2, unitPrice: 5_000 }],
        transactionNumber: "T-1",
      });
      await seedPosCorrection(ctx, store, {
        appliedAt: at("16:00"),
        correctedTotal: 5_000,
        originalTotal: 10_000,
        quantityDelta: -1,
        transactionId,
      });
      return store;
    });
    await runReseed(t, seeded.storeId);

    await t.run(async (ctx) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const correction = (await ctx.db.query("reportFact").collect()).find(
        (fact) => fact.factKind === "correction",
      );
      expect(correction).toMatchObject({
        grossAmountMinor: -5_000,
        netAmountMinor: -5_000,
        quantity: -1,
        sourceDomain: "pos",
      });
    });
  });

  it("skips a service case already billed through the till", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      const transactionId = await seedPosSale(ctx, store, {
        completedAt: at("10:00"),
        lines: [{ quantity: 1, unitPrice: 4_000 }],
        transactionNumber: "T-1",
      });
      const serviceCaseId = await seedServiceCase(ctx, store, {
        completedAt: at("12:00"),
        lines: [{ amount: 4_000, quantity: 1 }],
      });
      await ctx.db.insert("posTransactionServiceLine", {
        pricingSource: "service_case_quote",
        quantity: 1,
        serviceCaseId,
        serviceMode: "repair",
        serviceName: "Repair",
        totalPrice: 4_000,
        transactionId,
        unitPrice: 4_000,
      });
      return store;
    });
    await runReseed(t, seeded.storeId);

    await t.run(async (ctx) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const facts = await ctx.db.query("reportFact").collect();
      // POS is the revenue authority for a till-billed case — counting the
      // service case too would double the sale.
      expect(facts.filter((fact) => fact.sourceDomain === "service")).toEqual(
        [],
      );
      // The POS walk carries the revenue exactly once: the merchandise line
      // plus the till-billed service line (revenue only, zero units — found
      // undercounted by verify on wigclub dev, 2026-07-28).
      const posFacts = facts.filter((fact) => fact.sourceDomain === "pos");
      expect(posFacts).toHaveLength(2);
      const serviceLineFact = posFacts.find((fact) => fact.quantity === 0);
      expect(serviceLineFact).toMatchObject({
        factKind: "sale",
        netAmountMinor: 4_000,
        quantity: 0,
      });
    });
  });

  it("falls back to a legacy order's inline items", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      const orderId = await seedOnlineOrder(ctx, store, {
        completedAt: at("11:00"),
        items: [{ price: 2_500, quantity: 2 }],
        orderNumber: "O-LEGACY",
      });
      // Older orders kept their lines inline. Move this one back to that shape.
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const stored = await ctx.db
        .query("onlineOrderItem")
        .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
        .collect();
      for (const item of stored)
        await ctx.db.delete("onlineOrderItem", item._id);
      await ctx.db.patch("onlineOrder", orderId, {
        items: stored.map(({ _creationTime, _id, ...rest }) => rest) as never,
      });
      return store;
    });
    await runReseed(t, seeded.storeId);

    await t.run(async (ctx) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const facts = await ctx.db.query("reportFact").collect();
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({
        // Positional line key: inline items have no document id to name.
        lineId: "inline:0",
        netAmountMinor: 5_000,
        quantity: 2,
        sourceDomain: "storefront",
      });
    });
  });

  it("ignores a superseded close", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await seedDailyClose(ctx, store, {
        completedAt: at("20:00"),
        lifecycleStatus: "superseded",
        operatingDate: DAY1,
        salesTotal: 999,
      });
      await seedDailyClose(ctx, store, {
        completedAt: at("21:00"),
        lifecycleStatus: "active",
        operatingDate: DAY1,
        salesTotal: 17_000,
      });
      return store;
    });
    await runReseed(t, seeded.storeId);

    await t.run(async (ctx) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const facts = await ctx.db.query("reportFact").collect();
      expect(facts).toHaveLength(1);
      expect(facts[0].netAmountMinor).toBe(17_000);
    });
  });
});

describe("reseed — purge", () => {
  it("deletes every derived row for the store before rebuilding", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);

      // Stale derived state from a previous (wrong) generation.
      await ctx.db.insert("reportFact", {
        currency: "GHS",
        discountAmountMinor: 0,
        factKind: "sale",
        fingerprint: "v1:deadbeef",
        fingerprintVersion: 1,
        grossAmountMinor: 999_999,
        lineId: "ghost",
        netAmountMinor: 999_999,
        occurredAt: at("10:00"),
        operatingDate: DAY1,
        quantity: 7,
        recordedAt: at("10:00"),
        sourceDomain: "pos",
        sourceId: "ghost",
        storeId: store.storeId,
        taxAmountMinor: 0,
      });
      await ctx.db.insert("reportDay", {
        currency: "GHS",
        factCount: 1,
        flags: {
          hasUncostedRevenue: false,
          mixedCurrency: false,
          quarantinedFactCount: 0,
        },
        foldVersion: 1,
        grossProfitMinor: 0,
        grossSalesMinor: 999_999,
        lastFactRecordedAt: 0,
        netSalesMinor: 999_999,
        operatingDate: DAY1,
        paymentAllocatedMinor: 0,
        paymentsCollectedMinor: 0,
        paymentsRefundedMinor: 0,
        refundsMinor: 0,
        status: "reconciled",
        storeId: store.storeId,
        uncostedRevenueMinor: 0,
        unitsReturned: 0,
        unitsSold: 7,
      });
      return store;
    });

    await runReseed(t, seeded.storeId);

    await t.run(async (ctx) => {
      // No sources exist, so a correct rebuild leaves nothing behind.
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      expect(await ctx.db.query("reportFact").collect()).toEqual([]);
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      expect(await ctx.db.query("reportDay").collect()).toEqual([]);
    });
  });

  it("leaves another store's derived rows untouched", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const stores = await t.run(async (ctx) => {
      const mine = await seedStore(ctx);
      const theirs = await seedStore(ctx);
      await ctx.db.insert("reportDay", {
        currency: "GHS",
        factCount: 3,
        flags: {
          hasUncostedRevenue: false,
          mixedCurrency: false,
          quarantinedFactCount: 0,
        },
        foldVersion: 1,
        grossProfitMinor: 0,
        grossSalesMinor: 4_200,
        lastFactRecordedAt: 0,
        netSalesMinor: 4_200,
        operatingDate: DAY1,
        paymentAllocatedMinor: 0,
        paymentsCollectedMinor: 0,
        paymentsRefundedMinor: 0,
        refundsMinor: 0,
        status: "reconciled",
        storeId: theirs.storeId,
        uncostedRevenueMinor: 0,
        unitsReturned: 0,
        unitsSold: 3,
      });
      return { mine, theirs };
    });

    await runReseed(t, stores.mine.storeId);

    await t.run(async (ctx) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const survivors = await ctx.db.query("reportDay").collect();
      expect(survivors).toHaveLength(1);
      expect(survivors[0].storeId).toBe(stores.theirs.storeId);
    });
  });

  it("visits every purge table before starting the walk", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);

    let cursor = normalizeReseedCursor(undefined);
    const visited: number[] = [];
    while (cursor.phase === "purge") {
      visited.push(cursor.purgeTableIndex);
      const progress = await t.run(async (ctx: MutationCtx) =>
        reseedStep(ctx, seeded.storeId, cursor),
      );
      cursor = progress.cursor!;
    }

    expect(visited).toEqual(RESEED_PURGE_TABLES.map((_, index) => index));
    expect(cursor.phase).toBe("pos_sale");
  });
});

describe("reseed — dirty marks", () => {
  it("keeps weekly current truth unavailable until the full source replay completes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await ctx.db.insert("storeSchedule", {
        organizationId: store.organizationId,
        storeId: store.storeId,
        timezone: "UTC",
        weeklyWindows: [],
        weeklyClosedDays: [0],
        dateExceptions: [],
        reportingCycleStartsOn: 1,
        effectiveFrom: Date.parse("2026-01-01T00:00:00Z"),
        status: "active",
        source: "admin",
        createdAt: NOW,
        updatedAt: NOW,
      });
      return store;
    });

    await t.run(async (ctx: MutationCtx) => {
      await reseedStep(ctx, seeded.storeId, normalizeReseedCursor(undefined));
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW)).toBe(
        "unavailable",
      );
      expect(
        (await ctx.db.get("store", seeded.storeId))?.reportingReseedStartedAt,
      ).toBe(NOW);
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test singleton assertion
      expect(await ctx.db.query("reportWeekCurrent").collect()).toHaveLength(0);
    });

    await runReseed(t, seeded.storeId);
    await t.run(async (ctx) => {
      expect(
        (await ctx.db.get("store", seeded.storeId))?.reportingReseedStartedAt,
      ).toBeUndefined();
      expect(
        await ctx.db
          .query("reportDirtyWeek")
          .withIndex("by_storeId", (q) => q.eq("storeId", seeded.storeId))
          .unique(),
      ).not.toBeNull();
    });
  });

  it("marks every operating date it touched for a rebuild", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await seedPosSale(ctx, store, {
        completedAt: at("10:00"),
        lines: [{ quantity: 1, unitPrice: 5_000 }],
        transactionNumber: "T-1",
      });
      await seedPosSale(ctx, store, {
        completedAt: Date.parse("2026-03-07T10:00:00Z"),
        lines: [{ quantity: 1, unitPrice: 5_000 }],
        transactionNumber: "T-2",
      });
      return store;
    });
    await runReseed(t, seeded.storeId);

    await t.run(async (ctx) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const marks = await ctx.db.query("reportDirtyDay").collect();
      const byDate = new Map(
        marks.map((mark) => [mark.operatingDate, mark.reason]),
      );
      expect(byDate.get(DAY1)).toBe("reseed");
      expect(byDate.get("2026-03-07")).toBe("reseed");
    });
  });
});

describe("reseed — idempotence and resumption", () => {
  it("retries the same source page after a contained fact-write failure", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    await t.run((ctx) =>
      seedPosSale(ctx, seeded, {
        completedAt: at("10:00"),
        lines: [{ quantity: 1, unitPrice: 500 }],
        transactionNumber: "write-failure",
      }),
    );
    const cursor: ReseedCursor = {
      pageCursor: null,
      phase: "pos_sale",
      purgeTableIndex: 0,
    };

    const failed = await t.run(async (ctx) => {
      const db = new Proxy(ctx.db, {
        get(target, property, receiver) {
          if (property === "insert") {
            return async (table: string, ...args: unknown[]) => {
              if (table === "reportFact")
                throw new Error("injected fact write failure");
              return (
                Reflect.get(target, property, receiver) as (
                  ...args: unknown[]
                ) => unknown
              ).apply(target, [table, ...args]);
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
      return reseedStep(
        { ...ctx, db } as unknown as MutationCtx,
        seeded.storeId,
        cursor,
      );
    });

    expect(failed.cursor).toEqual(cursor);
    expect(failed.retrying).toBe("fact_write_failure");

    const retried = await t.run((ctx: MutationCtx) =>
      reseedStep(ctx, seeded.storeId, cursor),
    );
    expect(retried.retrying).toBeUndefined();
    expect(retried.cursor).not.toEqual(cursor);
    expect(await factSignature(t)).toHaveLength(1);
  });

  it("stops reseed before reconstructing a source with more than 500 child rows", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    await t.run((ctx) =>
      seedPosSale(ctx, seeded, {
        completedAt: at("10:00"),
        lines: Array.from({ length: 501 }, () => ({
          quantity: 1,
          unitPrice: 1,
        })),
        transactionNumber: "oversized-transaction",
      }),
    );

    const progress = await t.run((ctx: MutationCtx) =>
      reseedStep(ctx, seeded.storeId, {
        pageCursor: null,
        phase: "pos_sale",
        purgeTableIndex: 0,
      }),
    );

    expect(progress.cursor).toBeNull();
    expect(progress.incomplete).toEqual({
      reason: "source_cap_exceeded",
      source: "pos_transaction_items",
    });
    expect(await factSignature(t)).toEqual([]);
  });

  it("produces an identical fact set when run twice", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedFullDay);

    await runReseed(t, seeded.storeId);
    const first = await factSignature(t);

    await runReseed(t, seeded.storeId);
    const second = await factSignature(t);

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);

    await t.run(async (ctx) => {
      // A second pass is a replay, not a conflict.
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const facts = await ctx.db.query("reportFact").collect();
      expect(facts.every((fact) => fact.quarantine === undefined)).toBe(true);
    });
  });

  it("resumes from a mid-walk cursor and lands on the same result", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const reference = convexTest(schema, modules);
    const referenceStore = await reference.run(seedFullDay);
    await runReseed(reference, referenceStore.storeId);
    const uninterrupted = await factSignature(reference);

    const t = convexTest(schema, modules);
    const seeded = await t.run(seedFullDay);

    // Stop part-way, keep NOTHING but the serialized cursor, then continue —
    // exactly what a scheduled continuation gets after a deploy or a crash.
    const { cursor } = await runReseed(t, seeded.storeId, { stopAfter: 12 });
    expect(cursor).not.toBeNull();
    const roundTripped = normalizeReseedCursor(
      JSON.parse(JSON.stringify(cursor)),
    );
    expect(roundTripped).toEqual(cursor);

    await resumeReseed(t, seeded.storeId, roundTripped);

    expect(await factSignature(t)).toEqual(uninterrupted);
  });

  it("restarts from the beginning when handed an unrecognised phase", () => {
    expect(
      normalizeReseedCursor({
        pageCursor: "abc",
        phase: "not_a_phase",
        purgeTableIndex: 3,
      }),
    ).toEqual({ pageCursor: null, phase: "purge", purgeTableIndex: 0 });
  });

  it("returns a null cursor once the walk is done", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    const { cursor, steps } = await runReseed(t, seeded.storeId);
    expect(cursor).toBeNull();
    expect(steps).toBeGreaterThan(RESEED_PURGE_TABLES.length);
  });

  it("drives itself to completion through the scheduler", async () => {
    // Fake timers rather than a `Date.now` spy: the scheduler has to actually
    // fire for the continuation chain to be under test.
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedFullDay);

    // The real entry point: one call, and the mutation chains its own
    // continuations until the walk is finished.
    await t.mutation(RESEED_MUTATION, { storeId: seeded.storeId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.run(async (ctx) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const facts = await ctx.db.query("reportFact").collect();
      expect(facts).toHaveLength(10);
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const marks = await ctx.db.query("reportDirtyDay").collect();
      expect(marks.map((mark) => mark.operatingDate)).toContain(DAY1);
    });
  });

  it("refuses to run for a store that does not exist", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    await t.run(async (ctx) => {
      await ctx.db.delete("store", seeded.storeId);
      await expect(
        reseedStep(ctx, seeded.storeId, normalizeReseedCursor(undefined)),
      ).rejects.toThrow(/unknown store/);
    });
  });
});
