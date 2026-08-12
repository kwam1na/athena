import { describe, expect, it } from "vitest";
import { foldDay } from "./foldDay";
import { REPORT_PAYMENT_PARTICIPATION_CAP } from "../../shared/reportsContract";
import type {
  CloseRef,
  FoldFact,
  ReportFactKind,
} from "../../shared/reportsContract";

/**
 * ---------------------------------------------------------------------------
 * Deliberate divergences from legacy `reporting/projections/factContributions.ts`
 * ---------------------------------------------------------------------------
 * The legacy contribution table is a SIGN-CONVENTION REFERENCE ONLY. Where the
 * design review found it wrong, this fold folds to truth. Each divergence:
 *
 * 1. Gross vs net are distinct fields, not the same number.
 *    Legacy emitted `{gross_sales: amount, net_sales: amount}` from a single
 *    `amountMinor`, so discounts had to be re-subtracted from net by a separate
 *    `discount` fact — double-counting whenever both were emitted. Facts now
 *    carry `grossAmountMinor` AND `netAmountMinor`; the fold adds each to its
 *    own metric and there is no `discount` fact kind at all.
 *
 * 2. `refund`/`return` are separate kinds with separate meanings.
 *    Legacy handled them in one branch, so every refund incremented
 *    `units_returned` even when no goods came back, and every return emitted
 *    `refunds` even for a zero-value exchange. Here: `refund` moves money only
 *    (refundsMinor, −netSales, NO unit movement); `return` moves goods and
 *    money (unitsReturned + refundsMinor + −netSales).
 *
 * 3. Legacy's `units_sold` was decremented by returns (`units_sold: signedQty`)
 *    while `units_returned` was also incremented — the same event hitting two
 *    metrics with opposite signs, which made "units sold today" unreadable.
 *    Here `unitsSold` counts sales (and signed void/correction reversals) only;
 *    returns land exclusively in `unitsReturned`.
 *
 * 4. Refund/return amounts are magnitude-normalised (`Math.abs`) rather than
 *    trusted-as-signed. Legacy's `amount > 0 ? -amount : amount` produced
 *    different results for emitters that already signed their refunds. The
 *    fold is now emitter-sign-agnostic for these kinds. Reversal kinds
 *    (`void`/`correction`) are the opposite: they are trusted exactly as
 *    carried, since only the emitter knows what is being negated.
 *
 * 5. Gross profit is all-or-nothing per day, never partial-and-silent.
 *    Legacy accumulated `gross_profit` from costed facts while separately
 *    reporting `uncosted_revenue`, so the profit number looked authoritative
 *    while covering an unknown fraction of revenue. Here ANY uncosted revenue
 *    forces `grossProfitMinor: null` (same rule per SKU) and the uncovered
 *    revenue is reported honestly in `uncostedRevenueMinor`.
 *
 * 6. Foreign-currency facts are EXCLUDED from totals, not silently summed.
 *    Legacy only suppressed the `gross_profit` line when currencies were
 *    incompatible and still added the foreign amount to sales. The fold has no
 *    FX rate, so it excludes the fact entirely and raises `flags.mixedCurrency`.
 *    (The fact still counts in `factCount` — it exists, it just isn't money we
 *    can add.)
 *
 * 7. `paymentsRefundedMinor` is a positive magnitude. Legacy stored the signed
 *    (negative) amount, which made the metric un-summable against
 *    `paymentsCollectedMinor` without knowing its sign convention. Refunded
 *    payments now arrive as their own `payment_refund` kind and accumulate as
 *    `Math.abs`, matching `refundsMinor`.
 *
 * 8. `procurement_receipt` / `inventory_issue` contribute NO metric here.
 *    Legacy folded purchase-commitment and inventory-consumption counters into
 *    the same metric space as sales. Those are not day-sales metrics and are
 *    absent from the frozen contract; cost basis reaches the fold only via
 *    `unitCostMinor` on the revenue fact itself.
 *
 * Open, deliberately scoped out of slice A: `refund` facts carry no
 * `unitCostMinor` path, so a money-only refund reduces net sales without
 * reversing any cost. Correct for refunds proper (no goods return); a return
 * with a cost basis does reverse cost, via case 4 below.
 */

const CLOSE_AT = 3_000;

function fact(overrides: Partial<FoldFact> & { factId: string }): FoldFact {
  return {
    sourceDomain: "pos",
    sourceId: "src-1",
    lineId: "",
    factKind: "sale",
    occurredAt: 1_000,
    recordedAt: 1_000,
    currency: "GHS",
    grossAmountMinor: 0,
    netAmountMinor: 0,
    taxAmountMinor: 0,
    discountAmountMinor: 0,
    quantity: 0,
    quarantined: false,
    ...overrides,
  };
}

function sale(over: Partial<FoldFact> & { factId: string }): FoldFact {
  return fact({
    factKind: "sale",
    grossAmountMinor: 1_000,
    netAmountMinor: 900,
    quantity: 1,
    ...over,
  });
}

/** Deterministic (seeded) shuffle so a failure is reproducible. */
function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("foldDay — per-kind golden semantics", () => {
  it("sale adds gross, net and units", () => {
    const { day } = foldDay("GHS", [
      sale({ factId: "f1", grossAmountMinor: 1_000, netAmountMinor: 900, quantity: 2 }),
    ]);
    expect(day.grossSalesMinor).toBe(1_000);
    expect(day.netSalesMinor).toBe(900);
    expect(day.unitsSold).toBe(2);
    expect(day.unitsReturned).toBe(0);
    expect(day.refundsMinor).toBe(0);
  });

  it("refund adds refunds and subtracts net sales, moving no units", () => {
    const { day } = foldDay("GHS", [
      fact({
        factId: "f1",
        factKind: "refund",
        netAmountMinor: 500,
        quantity: 1,
        unitCostMinor: undefined,
      }),
    ]);
    expect(day.refundsMinor).toBe(500);
    expect(day.netSalesMinor).toBe(-500);
    expect(day.unitsReturned).toBe(0);
    expect(day.unitsSold).toBe(0);
  });

  it("refund is sign-agnostic — +500 and -500 fold identically", () => {
    const positive = foldDay("GHS", [
      fact({ factId: "f1", factKind: "refund", netAmountMinor: 500 }),
    ]);
    const negative = foldDay("GHS", [
      fact({ factId: "f1", factKind: "refund", netAmountMinor: -500 }),
    ]);
    expect(positive).toEqual(negative);
  });

  it("return adds unitsReturned, refunds and subtracts net sales", () => {
    const { day } = foldDay("GHS", [
      fact({
        factId: "f1",
        factKind: "return",
        netAmountMinor: 900,
        quantity: 2,
      }),
    ]);
    expect(day.unitsReturned).toBe(2);
    expect(day.refundsMinor).toBe(900);
    expect(day.netSalesMinor).toBe(-900);
    expect(day.unitsSold).toBe(0);
  });

  it("void/correction negate exactly as carried (fold trusts the emitter's signs)", () => {
    const { day } = foldDay("GHS", [
      sale({ factId: "f1" }),
      fact({
        factId: "f2",
        factKind: "void",
        grossAmountMinor: -1_000,
        netAmountMinor: -900,
        quantity: -1,
      }),
      fact({
        factId: "f3",
        factKind: "correction",
        grossAmountMinor: 200,
        netAmountMinor: 150,
        quantity: 0,
      }),
    ]);
    expect(day.grossSalesMinor).toBe(200);
    expect(day.netSalesMinor).toBe(150);
    expect(day.unitsSold).toBe(0);
  });

  it("derives complete payment posture without changing sales recognition", () => {
    const { day } = foldDay("GHS", [
      fact({
        factId: "f1",
        sourceDomain: "payments",
        factKind: "payment",
        netAmountMinor: 2_000,
        paymentAllocationCoverage: "known",
        paymentAllocationMinor: 2_000,
      }),
      fact({
        factId: "f2",
        sourceDomain: "payments",
        factKind: "payment_refund",
        netAmountMinor: -750,
        paymentAllocationCoverage: "known",
        paymentAllocationMinor: -750,
      }),
    ]);
    expect(day.paymentsCollectedMinor).toBe(2_000);
    expect(day.paymentAllocatedMinor).toBe(1_250);
    expect(day.paymentsRefundedMinor).toBe(750);
    expect(day.paymentPosture).toEqual({
      collectedMinor: 2_000,
      refundedMinor: 750,
      allocatedMinor: 1_250,
      unsettledMinor: 0,
      allocationCoverage: "complete",
      allocationOmittedMinor: 0,
      hasInvalidAllocation: false,
    });
    expect(day.netSalesMinor).toBe(0);
    expect(day.grossSalesMinor).toBe(0);
  });

  it("discloses partial, over-allocated, and legacy-unknown allocation coverage", () => {
    const partial = foldDay("GHS", [
      fact({
        factId: "partial",
        factKind: "payment",
        sourceDomain: "payments",
        netAmountMinor: 2_000,
        paymentAllocationCoverage: "known",
        paymentAllocationMinor: 1_250,
      }),
    ]);
    expect(partial.day.paymentPosture.unsettledMinor).toBe(750);

    const overAllocated = foldDay("GHS", [
      fact({
        factId: "over",
        factKind: "payment",
        sourceDomain: "payments",
        netAmountMinor: 2_000,
        paymentAllocationCoverage: "known",
        paymentAllocationMinor: 2_100,
      }),
    ]);
    expect(overAllocated.day.paymentPosture).toMatchObject({
      unsettledMinor: 0,
      hasInvalidAllocation: true,
    });

    const legacy = foldDay("GHS", [
      fact({
        factId: "legacy",
        factKind: "payment",
        sourceDomain: "payments",
        netAmountMinor: 2_000,
      }),
    ]);
    expect(legacy.day.paymentPosture).toMatchObject({
      allocationCoverage: "unknown",
      allocationOmittedMinor: 2_000,
      unsettledMinor: null,
    });
  });

  it("clamps unsettled value to zero when refunds exceed eligible collection", () => {
    const { day } = foldDay("GHS", [
      fact({
        factId: "collect",
        sourceDomain: "payments",
        factKind: "payment",
        netAmountMinor: 5_000,
        paymentAllocationCoverage: "known",
        paymentAllocationMinor: 5_000,
      }),
      fact({
        factId: "over-refund",
        sourceDomain: "payments",
        factKind: "payment_refund",
        netAmountMinor: 8_000,
        paymentAllocationCoverage: "known",
        paymentAllocationMinor: -8_000,
      }),
    ]);
    expect(day.paymentPosture).toEqual({
      collectedMinor: 5_000,
      refundedMinor: 8_000,
      // Net allocation went negative: real, disclosed, and never clamped away.
      allocatedMinor: -3_000,
      unsettledMinor: 0,
      allocationCoverage: "complete",
      allocationOmittedMinor: 0,
      hasInvalidAllocation: true,
    });
    expect(day.paymentPosture.unsettledMinor).not.toBeLessThan(0);
  });

  it("close_snapshot, inventory_issue and procurement_receipt contribute no metrics", () => {
    const inert: ReportFactKind[] = [
      "close_snapshot",
      "inventory_issue",
      "procurement_receipt",
    ];
    const facts = inert.map((factKind, i) =>
      fact({
        factId: `f${i}`,
        factKind,
        sourceDomain: factKind === "close_snapshot" ? "daily_close" : "inventory",
        currency: "ghs",
        grossAmountMinor: 5_000,
        netAmountMinor: 5_000,
        quantity: 7,
        unitCostMinor: 400,
        productSkuId: "sku-1",
      }),
    );
    const { day, skuDays } = foldDay("GHS", facts);
    expect(day.grossSalesMinor).toBe(0);
    expect(day.netSalesMinor).toBe(0);
    expect(day.unitsSold).toBe(0);
    expect(day.grossProfitMinor).toBe(0);
    expect(day.factCount).toBe(3);
    expect(day.flags.mixedCurrency).toBe(false);
    expect(skuDays.size).toBe(0);
  });
});

describe("foldDay — gross profit and cost basis", () => {
  it("accumulates profit as net minus unit cost times quantity", () => {
    const { day } = foldDay("GHS", [
      sale({
        factId: "f1",
        netAmountMinor: 1_000,
        quantity: 2,
        unitCostMinor: 300,
      }),
    ]);
    expect(day.grossProfitMinor).toBe(400);
    expect(day.uncostedRevenueMinor).toBe(0);
    expect(day.flags.hasUncostedRevenue).toBe(false);
  });

  it("a costed return reverses both revenue and cost", () => {
    const { day } = foldDay("GHS", [
      sale({
        factId: "f1",
        netAmountMinor: 1_000,
        quantity: 2,
        unitCostMinor: 300,
      }),
      fact({
        factId: "f2",
        factKind: "return",
        netAmountMinor: 500,
        quantity: 1,
        unitCostMinor: 300,
      }),
    ]);
    // sale: 1000 - 600 = 400; return: -500 + 300 = -200
    expect(day.grossProfitMinor).toBe(200);
  });

  it("any uncosted revenue nulls gross profit and is reported honestly", () => {
    const { day } = foldDay("GHS", [
      sale({ factId: "f1", netAmountMinor: 1_000, quantity: 1, unitCostMinor: 400 }),
      sale({ factId: "f2", netAmountMinor: 700, quantity: 1 }),
    ]);
    expect(day.grossProfitMinor).toBeNull();
    expect(day.uncostedRevenueMinor).toBe(700);
    expect(day.flags.hasUncostedRevenue).toBe(true);
    expect(day.netSalesMinor).toBe(1_700);
  });

  it("zero-revenue facts without a cost basis do not raise the uncosted flag", () => {
    const { day } = foldDay("GHS", [
      sale({ factId: "f1", grossAmountMinor: 0, netAmountMinor: 0, quantity: 0 }),
    ]);
    expect(day.flags.hasUncostedRevenue).toBe(false);
    expect(day.grossProfitMinor).toBe(0);
  });
});

describe("foldDay — exclusions", () => {
  it("excludes quarantined facts from metrics but counts them", () => {
    const { day, skuDays } = foldDay("GHS", [
      sale({ factId: "f1", productSkuId: "sku-1" }),
      sale({
        factId: "f2",
        productSkuId: "sku-2",
        quarantined: true,
        netAmountMinor: 99_999,
      }),
    ]);
    expect(day.netSalesMinor).toBe(900);
    expect(day.flags.quarantinedFactCount).toBe(1);
    expect(day.factCount).toBe(2);
    expect(skuDays.has("sku-2")).toBe(false);
  });

  it("excludes foreign-currency facts from totals and flags mixed currency", () => {
    const { day, skuDays } = foldDay("GHS", [
      sale({ factId: "f1", productSkuId: "sku-1" }),
      sale({
        factId: "f2",
        productSkuId: "sku-usd",
        currency: "USD",
        netAmountMinor: 50_000,
        grossAmountMinor: 50_000,
        quantity: 3,
      }),
    ]);
    expect(day.netSalesMinor).toBe(900);
    expect(day.grossSalesMinor).toBe(1_000);
    expect(day.unitsSold).toBe(1);
    expect(day.flags.mixedCurrency).toBe(true);
    expect(day.factCount).toBe(2);
    expect(skuDays.has("sku-usd")).toBe(false);
  });

  it("does not flag mixed currency when every fact is in store currency", () => {
    const { day } = foldDay("USD", [
      sale({ factId: "f1", currency: "USD" }),
    ]);
    expect(day.flags.mixedCurrency).toBe(false);
  });
});

describe("foldDay — skuDays", () => {
  it("is sparse: only SKUs with sku-attributable activity appear", () => {
    const { skuDays } = foldDay("GHS", [
      sale({ factId: "f1", productSkuId: "sku-a", netAmountMinor: 900, quantity: 1 }),
      fact({
        factId: "f2",
        factKind: "return",
        productSkuId: "sku-b",
        netAmountMinor: 400,
        quantity: 1,
      }),
      // No productSkuId → day-level only.
      sale({ factId: "f3", netAmountMinor: 100, quantity: 1 }),
      // Payment carries a sku id but is not sku-attributable.
      fact({
        factId: "f4",
        factKind: "payment",
        productSkuId: "sku-c",
        netAmountMinor: 5_000,
      }),
    ]);
    expect([...skuDays.keys()].sort()).toEqual(["sku-a", "sku-b"]);
    expect(skuDays.get("sku-a")).toEqual({
      unitsSold: 1,
      unitsReturned: 0,
      grossSalesMinor: 1_000,
      netSalesMinor: 900,
      refundsMinor: 0,
      uncostedRevenueMinor: 900,
      grossProfitMinor: null,
    });
    expect(skuDays.get("sku-b")).toEqual({
      unitsSold: 0,
      unitsReturned: 1,
      grossSalesMinor: 0,
      netSalesMinor: -400,
      refundsMinor: 400,
      uncostedRevenueMinor: -400,
      grossProfitMinor: null,
    });
  });

  it("nulls gross profit per SKU independently", () => {
    const { skuDays } = foldDay("GHS", [
      sale({
        factId: "f1",
        productSkuId: "costed",
        netAmountMinor: 1_000,
        quantity: 1,
        unitCostMinor: 250,
      }),
      sale({ factId: "f2", productSkuId: "uncosted", netAmountMinor: 800, quantity: 1 }),
    ]);
    expect(skuDays.get("costed")!.grossProfitMinor).toBe(750);
    expect(skuDays.get("uncosted")!.grossProfitMinor).toBeNull();
  });
});

describe("foldDay — status, close variance and amendment", () => {
  const close: CloseRef = {
    closeId: "close-1",
    acceptedAt: CLOSE_AT,
    closeNetSalesMinor: 900,
    transactionCount: 12,
  };

  it("is provisional with no close and carries no variance fields", () => {
    const { day } = foldDay("GHS", [sale({ factId: "f1" })]);
    expect(day.status).toBe("provisional");
    expect(day.closeVarianceMinor).toBeUndefined();
    expect(day.postCloseNetSalesDeltaMinor).toBeUndefined();
    // The count is NOT close-gated: it is derived from the facts already being
    // folded, so an unclosed day still reports a basket. Provisional like
    // every other number here — the close's settled figure replaces it.
    expect(day.transactionCount).toBe(1);
  });

  it("counts distinct transactions, not lines or payments", () => {
    // Three sale facts across two transactions. Counting facts would say 3;
    // counting payment facts would double a split-tender sale.
    const { day } = foldDay("GHS", [
      sale({ factId: "f1", lineId: "l1", sourceId: "t1" }),
      sale({ factId: "f2", lineId: "l2", sourceId: "t1" }),
      sale({ factId: "f3", lineId: "l1", sourceId: "t2" }),
    ]);
    expect(day.transactionCount).toBe(2);
  });

  it("excludes a voided transaction, which still carries its sale facts", () => {
    const { day } = foldDay("GHS", [
      sale({ factId: "f1", lineId: "l1", sourceId: "t1" }),
      sale({ factId: "f2", lineId: "l1", sourceId: "t2" }),
      { ...sale({ factId: "f3", lineId: "l1", sourceId: "t2" }), factKind: "void" },
    ]);
    expect(day.transactionCount).toBe(1);
  });

  it("records the close's settled transaction count on the day", () => {
    // Kept on the day so a period read can sum basket-size evidence without
    // reopening every close.
    const { day } = foldDay(
      "GHS",
      [sale({ factId: "f1", recordedAt: CLOSE_AT })],
      close,
    );
    expect(day.transactionCount).toBe(12);
  });

  it("keeps the settled count when post-close activity amends the day", () => {
    const { day } = foldDay(
      "GHS",
      [sale({ factId: "f1", recordedAt: CLOSE_AT + 1_000 })],
      close,
    );
    expect(day.status).toBe("amended");
    expect(day.transactionCount).toBe(12);
  });

  it("is reconciled when every fact predates the close acceptance", () => {
    const { day } = foldDay(
      "GHS",
      [sale({ factId: "f1", recordedAt: CLOSE_AT })],
      close,
    );
    expect(day.status).toBe("reconciled");
    expect(day.closeVarianceMinor).toBe(0);
    expect(day.postCloseNetSalesDeltaMinor).toBeUndefined();
  });

  it("reports a non-zero variance against a disagreeing close", () => {
    const { day } = foldDay(
      "GHS",
      [sale({ factId: "f1", recordedAt: 1_000, netAmountMinor: 1_150 })],
      close,
    );
    expect(day.status).toBe("reconciled");
    expect(day.closeVarianceMinor).toBe(250);
  });

  it("is amended when a fact was recorded after the close, with the post-close delta", () => {
    const { day } = foldDay(
      "GHS",
      [
        sale({ factId: "f1", recordedAt: 1_000 }),
        fact({
          factId: "f2",
          factKind: "refund",
          recordedAt: CLOSE_AT + 1,
          netAmountMinor: 200,
        }),
        sale({ factId: "f3", recordedAt: CLOSE_AT + 2, netAmountMinor: 50 }),
      ],
      close,
    );
    expect(day.status).toBe("amended");
    expect(day.netSalesMinor).toBe(750);
    expect(day.postCloseNetSalesDeltaMinor).toBe(-150);
    expect(day.closeVarianceMinor).toBe(-150);
  });

  it("empty day with no close is a zeroed provisional day", () => {
    const result = foldDay("GHS", []);
    expect(result.skuDays.size).toBe(0);
    expect(result.day).toEqual({
      grossSalesMinor: 0,
      netSalesMinor: 0,
      refundsMinor: 0,
      unitsSold: 0,
      unitsReturned: 0,
      uncostedRevenueMinor: 0,
      grossProfitMinor: 0,
      paymentsCollectedMinor: 0,
      paymentsRefundedMinor: 0,
      paymentAllocatedMinor: 0,
      paymentPosture: {
        collectedMinor: 0,
        refundedMinor: 0,
        allocatedMinor: 0,
        unsettledMinor: 0,
        allocationCoverage: "complete",
        allocationOmittedMinor: 0,
        hasInvalidAllocation: false,
      },
      // Zero receipts is a KNOWN empty mix, not missing evidence.
      paymentMix: { status: "complete", totalMinor: 0, rows: [] },
      paymentMixState: {
        amountByMethod: [],
        participation: [],
        unattributedMinor: 0,
        evidenceBroken: false,
      },
      status: "provisional",
      flags: {
        mixedCurrency: false,
        hasUncostedRevenue: false,
        quarantinedFactCount: 0,
      },
      factCount: 0,
      lastFactRecordedAt: 0,
      // A day with no facts sold nothing. Zero here is a measurement, not a
      // placeholder — the fold saw every fact there was.
      transactionCount: 0,
    });
  });

  it("empty day with a close reconciles with the close's own value as variance", () => {
    const { day } = foldDay("GHS", [], close);
    expect(day.status).toBe("reconciled");
    expect(day.closeVarianceMinor).toBe(-900);
    expect(day.factCount).toBe(0);
  });

  it("tracks factCount and lastFactRecordedAt across excluded facts too", () => {
    const { day } = foldDay("GHS", [
      sale({ factId: "f1", recordedAt: 1_000 }),
      sale({ factId: "f2", recordedAt: 9_000, quarantined: true }),
      sale({ factId: "f3", recordedAt: 5_000, currency: "USD" }),
    ]);
    expect(day.factCount).toBe(3);
    expect(day.lastFactRecordedAt).toBe(9_000);
  });
});

describe("foldDay — determinism", () => {
  const close: CloseRef = {
    closeId: "close-1",
    acceptedAt: CLOSE_AT,
    closeNetSalesMinor: 1_234,
    transactionCount: 7,
  };

  const corpus: FoldFact[] = [
    sale({ factId: "a", occurredAt: 100, productSkuId: "sku-1", unitCostMinor: 300 }),
    sale({
      factId: "b",
      occurredAt: 100,
      sourceId: "src-0",
      lineId: "L2",
      productSkuId: "sku-2",
      netAmountMinor: 450,
    }),
    fact({
      factId: "c",
      factKind: "return",
      occurredAt: 200,
      productSkuId: "sku-1",
      netAmountMinor: 300,
      quantity: 1,
      unitCostMinor: 300,
    }),
    fact({
      factId: "d",
      factKind: "refund",
      occurredAt: 200,
      sourceId: "src-2",
      netAmountMinor: 120,
      recordedAt: CLOSE_AT + 10,
    }),
    fact({
      factId: "e",
      factKind: "payment",
      occurredAt: 150,
      sourceDomain: "payments",
      netAmountMinor: 3_000,
    }),
    fact({
      factId: "f",
      factKind: "payment_refund",
      occurredAt: 150,
      sourceDomain: "payments",
      netAmountMinor: -120,
    }),
    fact({
      factId: "g",
      factKind: "void",
      occurredAt: 250,
      grossAmountMinor: -1_000,
      netAmountMinor: -900,
      quantity: -1,
      productSkuId: "sku-2",
    }),
    fact({
      factId: "h",
      factKind: "close_snapshot",
      sourceDomain: "daily_close",
      occurredAt: 300,
    }),
    sale({ factId: "i", occurredAt: 100, currency: "USD", netAmountMinor: 77 }),
    sale({ factId: "j", occurredAt: 100, quarantined: true, netAmountMinor: 88 }),
  ];

  it("produces a deep-equal result for any input order", () => {
    const baseline = foldDay("GHS", corpus, close);
    for (const seed of [1, 7, 42, 1_337, 99_991]) {
      const shuffled = foldDay("GHS", shuffle(corpus, seed), close);
      expect(shuffled).toEqual(baseline);
      expect([...shuffled.skuDays.keys()]).toEqual([...baseline.skuDays.keys()]);
    }
  });

  it("does not mutate or reorder the caller's array", () => {
    const input = [...corpus];
    const snapshot = input.map((f) => f.factId);
    foldDay("GHS", input, close);
    expect(input.map((f) => f.factId)).toEqual(snapshot);
  });

  it("orders facts by (occurredAt, sourceId, lineId, factKind) — ties fold identically", () => {
    const tied = [
      fact({ factId: "x", factKind: "sale", netAmountMinor: 10, quantity: 1 }),
      fact({ factId: "y", factKind: "refund", netAmountMinor: 4 }),
      fact({ factId: "z", factKind: "correction", netAmountMinor: 1 }),
    ];
    const forward = foldDay("GHS", tied);
    const backward = foldDay("GHS", [...tied].reverse());
    expect(forward).toEqual(backward);
    expect(forward.day.netSalesMinor).toBe(7);
  });
});

describe("foldDay — payment mix", () => {
  /** A recorded inbound allocation with full mix evidence. */
  function receipt(args: {
    factId: string;
    amountMinor: number;
    method: "cash" | "card" | "mobile_money";
    participationId: string;
    occurredAt?: number;
  }): FoldFact {
    return fact({
      factId: args.factId,
      sourceDomain: "payments",
      sourceId: `alloc-${args.factId}`,
      factKind: "payment",
      occurredAt: args.occurredAt ?? 1_000,
      grossAmountMinor: args.amountMinor,
      netAmountMinor: args.amountMinor,
      paymentAllocationCoverage: "known",
      paymentAllocationMinor: args.amountMinor,
      paymentMethod: args.method,
      paymentParticipationId: args.participationId,
      paymentMixMinor: args.amountMinor,
    });
  }

  it("reconciles complete rows exactly to paymentsCollectedMinor", () => {
    const { day } = foldDay("GHS", [
      receipt({ factId: "a", amountMinor: 6_000, method: "cash", participationId: "txn-1" }),
      receipt({ factId: "b", amountMinor: 3_000, method: "card", participationId: "txn-2" }),
      receipt({ factId: "c", amountMinor: 1_000, method: "mobile_money", participationId: "txn-3" }),
    ]);

    expect(day.paymentsCollectedMinor).toBe(10_000);
    expect(day.paymentMix).toEqual({
      status: "complete",
      totalMinor: 10_000,
      rows: [
        { method: "cash", amountMinor: 6_000, shareBasisPoints: 6_000, tenderUseCount: 1 },
        { method: "card", amountMinor: 3_000, shareBasisPoints: 3_000, tenderUseCount: 1 },
        {
          method: "mobile_money",
          amountMinor: 1_000,
          shareBasisPoints: 1_000,
          tenderUseCount: 1,
        },
      ],
    });
  });

  it("counts one tender use for repeated same-method allocations on one transaction", () => {
    const { day } = foldDay("GHS", [
      receipt({ factId: "a", amountMinor: 2_000, method: "cash", participationId: "txn-1" }),
      receipt({ factId: "b", amountMinor: 1_000, method: "cash", participationId: "txn-1" }),
    ]);

    expect(day.paymentsCollectedMinor).toBe(3_000);
    // Full combined value, one use — Daily Close's `buildPaymentTotals` rule.
    expect(day.paymentMix).toMatchObject({
      status: "complete",
      rows: [{ method: "cash", amountMinor: 3_000, tenderUseCount: 1 }],
    });
  });

  it("counts one use per method for split tender on one transaction", () => {
    const { day } = foldDay("GHS", [
      receipt({ factId: "a", amountMinor: 2_000, method: "cash", participationId: "txn-1" }),
      receipt({ factId: "b", amountMinor: 2_000, method: "card", participationId: "txn-1" }),
    ]);

    expect(day.paymentMix).toMatchObject({
      status: "complete",
      rows: [
        { method: "cash", amountMinor: 2_000, tenderUseCount: 1 },
        { method: "card", amountMinor: 2_000, tenderUseCount: 1 },
      ],
    });
  });

  it("keeps non-POS allocations independently countable", () => {
    const { day } = foldDay("GHS", [
      receipt({ factId: "a", amountMinor: 2_000, method: "cash", participationId: "alloc-a" }),
      receipt({ factId: "b", amountMinor: 1_000, method: "cash", participationId: "alloc-b" }),
    ]);

    expect(day.paymentMix).toMatchObject({
      status: "complete",
      rows: [{ method: "cash", amountMinor: 3_000, tenderUseCount: 2 }],
    });
  });

  it("moves value and use across methods on a correction without touching totals", () => {
    const correction = fact({
      factId: "corr",
      sourceDomain: "pos",
      sourceId: "txn-1",
      lineId: "event-1",
      factKind: "correction",
      occurredAt: 2_000,
      paymentMethodFrom: "cash",
      paymentMethod: "card",
      paymentParticipationId: "txn-1",
      paymentMixMinor: 5_000,
    });
    const { day } = foldDay("GHS", [
      receipt({ factId: "a", amountMinor: 5_000, method: "cash", participationId: "txn-1" }),
      correction,
    ]);

    expect(day.paymentsCollectedMinor).toBe(5_000);
    expect(day.paymentMix).toEqual({
      status: "complete",
      totalMinor: 5_000,
      rows: [
        { method: "card", amountMinor: 5_000, shareBasisPoints: 10_000, tenderUseCount: 1 },
      ],
    });
  });

  it("publishes a complete empty mix for a day with zero receipts", () => {
    const { day } = foldDay("GHS", [
      fact({ factId: "s", factKind: "sale", netAmountMinor: 0 }),
    ]);
    expect(day.paymentMix).toEqual({ status: "complete", totalMinor: 0, rows: [] });
  });

  it("withholds the mix rather than publishing a partial one", () => {
    const methodless = fact({
      factId: "legacy",
      sourceDomain: "payments",
      sourceId: "alloc-legacy",
      factKind: "payment",
      grossAmountMinor: 4_000,
      netAmountMinor: 4_000,
      paymentAllocationCoverage: "known",
      paymentAllocationMinor: 4_000,
    });

    // A legacy fact with no method at all.
    expect(
      foldDay("GHS", [
        receipt({ factId: "a", amountMinor: 1_000, method: "cash", participationId: "txn-1" }),
        methodless,
      ]).day.paymentMix,
    ).toEqual({ status: "unavailable" });

    // A quarantined payment fact: excluded from totals, so the remaining rows
    // would still add up — which is exactly why the day must say unavailable
    // instead of presenting a breakdown built on damaged evidence.
    expect(
      foldDay("GHS", [
        receipt({ factId: "a", amountMinor: 1_000, method: "cash", participationId: "txn-1" }),
        { ...methodless, quarantined: true },
      ]).day.paymentMix,
    ).toEqual({ status: "unavailable" });

    // Foreign-currency payment evidence on the day.
    expect(
      foldDay("GHS", [
        receipt({ factId: "a", amountMinor: 1_000, method: "cash", participationId: "txn-1" }),
        { ...methodless, currency: "USD" },
      ]).day.paymentMix,
    ).toEqual({ status: "unavailable" });
  });

  it("adds no gross mix value or use from refunds", () => {
    const { day } = foldDay("GHS", [
      receipt({ factId: "a", amountMinor: 5_000, method: "cash", participationId: "txn-1" }),
      fact({
        factId: "r",
        sourceDomain: "payments",
        sourceId: "alloc-r",
        factKind: "payment_refund",
        grossAmountMinor: 2_000,
        netAmountMinor: 2_000,
        paymentAllocationCoverage: "known",
        paymentAllocationMinor: -2_000,
      }),
    ]);

    expect(day.paymentsRefundedMinor).toBe(2_000);
    expect(day.paymentMix).toMatchObject({
      status: "complete",
      totalMinor: 5_000,
      rows: [{ method: "cash", amountMinor: 5_000, tenderUseCount: 1 }],
    });
  });

  it("folds to the same mix regardless of fact order", () => {
    const corpus = [
      receipt({ factId: "a", amountMinor: 2_000, method: "cash", participationId: "txn-1" }),
      receipt({ factId: "b", amountMinor: 1_000, method: "cash", participationId: "txn-1" }),
      receipt({ factId: "c", amountMinor: 4_000, method: "mobile_money", participationId: "txn-2" }),
      fact({
        factId: "corr",
        sourceDomain: "pos",
        sourceId: "txn-2",
        lineId: "event-1",
        factKind: "correction",
        occurredAt: 2_000,
        paymentMethodFrom: "mobile_money",
        paymentMethod: "card",
        paymentParticipationId: "txn-2",
        paymentMixMinor: 4_000,
      }),
    ];
    const baseline = foldDay("GHS", corpus).day.paymentMix;
    for (const seed of [1, 7, 42, 1_337]) {
      expect(foldDay("GHS", shuffle(corpus, seed)).day.paymentMix).toEqual(baseline);
    }
    expect(baseline).toMatchObject({
      status: "complete",
      totalMinor: 7_000,
      rows: [
        { method: "cash", amountMinor: 3_000, tenderUseCount: 1 },
        { method: "card", amountMinor: 4_000, tenderUseCount: 1 },
      ],
    });
  });
});

describe("foldDay — payment mix participation bound", () => {
  it("clamps over-cap participation state instead of persisting an unbounded array", () => {
    const facts: FoldFact[] = [];
    for (let index = 0; index <= REPORT_PAYMENT_PARTICIPATION_CAP; index += 1) {
      facts.push(
        fact({
          factId: `p-${index}`,
          sourceDomain: "payments",
          sourceId: `alloc-${index}`,
          factKind: "payment",
          grossAmountMinor: 10,
          netAmountMinor: 10,
          paymentAllocationCoverage: "known",
          paymentAllocationMinor: 10,
          paymentMethod: "cash",
          paymentParticipationId: `alloc-${index}`,
          paymentMixMinor: 10,
        }),
      );
    }

    const { day } = foldDay("GHS", facts);
    // The published conclusion is honest…
    expect(day.paymentMix).toEqual({ status: "unavailable" });
    // …and the PERSISTED evidence is bounded too: the state rides on the day
    // document, so past the cap it collapses to a broken marker rather than
    // an ever-growing array that would eventually breach the document limit.
    expect(day.paymentMixState).toEqual({
      amountByMethod: [],
      participation: [],
      unattributedMinor: 0,
      evidenceBroken: true,
    });
  });
});
