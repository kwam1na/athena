/// <reference types="vite/client" />
/**
 * Characterization of the report seams the `reports.*` agent package reshapes
 * (V26-1267, posture: characterization-first).
 *
 * `reportDay` / `reportSkuDay` are the authoritative daily record: a folded day
 * carries `status !== "open"`, a `certifiedFoldRevision`, and a payment mix; an
 * open day is a provisional preview maintained inside the sale's transaction.
 * That distinction is the whole basis of the `accepted` versus `live` freshness
 * class the agent surface must report, so it is pinned here first.
 */
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { getStorePulseSummaryForWindow } from "../../pos/application/queries/storePulse";
import {
  CURRENT_OPERATING_DATE,
  PRIOR_OPERATING_DATE,
  dayEnd,
  dayStart,
  seedDailyOperationsStore,
} from "../../agentHarness/evals/dailyOperations.fixture";

const modules = import.meta.glob("../../**/*.ts");

async function readDay(t: TestConvex<typeof schema>, storeId: Id<"store">, operatingDate: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query("reportDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", storeId).eq("operatingDate", operatingDate),
      )
      .first(),
  );
}

describe("report seams (characterization)", () => {
  it("distinguishes an accepted folded day from the open live day", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run((ctx) => seedDailyOperationsStore(ctx));

    const accepted = await readDay(t, fixture.storeId, PRIOR_OPERATING_DATE);
    expect(accepted?.status).toBe("reconciled");
    expect(accepted?.certifiedFoldRevision).toBe(7);
    expect(accepted?.foldedAt).toBe(dayEnd(PRIOR_OPERATING_DATE));
    expect(accepted?.netSalesMinor).toBe(30_000);
    expect(accepted?.transactionCount).toBe(1);
    expect(accepted?.paymentMix?.status).toBe("complete");

    const live = await readDay(t, fixture.storeId, CURRENT_OPERATING_DATE);
    expect(live?.status).toBe("open");
    // An open day carries no fold revision and no payment mix: it is a preview.
    expect(live?.certifiedFoldRevision).toBeUndefined();
    expect(live?.foldedAt).toBeUndefined();
    expect(live?.paymentMix).toBeUndefined();
    expect(live?.netSalesMinor).toBe(95_000);
    expect(live?.transactionCount).toBe(2);
  });

  it("returns per-SKU day rows only for SKUs with activity", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run((ctx) => seedDailyOperationsStore(ctx));
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("reportSkuDay")
        .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
          q.eq("storeId", fixture.storeId).eq("operatingDate", CURRENT_OPERATING_DATE),
        )
        .take(50),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.unitsSold)).toEqual([1, 1]);
    expect(rows.every((row) => row.certifiedFoldRevision === undefined)).toBe(true);
  });

  it("summarises the store pulse for a bounded window", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run((ctx) => seedDailyOperationsStore(ctx));
    const pulse = await t.run((ctx) =>
      getStorePulseSummaryForWindow(ctx, {
        currentDayEnd: dayEnd(CURRENT_OPERATING_DATE) - 1,
        currentDayStart: dayStart(CURRENT_OPERATING_DATE),
        currentOperatingDate: CURRENT_OPERATING_DATE,
        pulseWindow: "today",
        storeId: fixture.storeId,
      }),
    );

    expect(pulse.totalSales).toBe(95_000);
    expect(pulse.totalTransactions).toBe(2);
    expect(pulse.date).toBe(CURRENT_OPERATING_DATE);
    expect(pulse.averageTransaction).toBe(47_500);
    // The operator snapshot carries the bounded comparison + trend the surface renders.
    expect(pulse.operatorSnapshot.comparison.currentSales).toBe(95_000);
    expect(Array.isArray(pulse.operatorSnapshot.trend)).toBe(true);
    expect(Array.isArray(pulse.operatorSnapshot.paymentMix)).toBe(true);
    expect(Array.isArray(pulse.operatorSnapshot.topItems)).toBe(true);
  });
});
