import { describe, expect, it } from "vitest";
import { buildAdjustmentReportTotals } from "./adjustmentReports";

describe("daily close adjustment reports", () => {
  it("adds applied same-day sale adjustments to adjusted sales and settlement totals", () => {
    const totals = buildAdjustmentReportTotals({
      appliedAdjustments: [
        {
          _id: "adjustment-1",
          appliedAt: 1,
          settlementMethod: "cash",
          signedSalesDelta: 500,
          signedSettlementAmount: 500,
          transactionId: "txn-1",
        },
        {
          _id: "adjustment-2",
          appliedAt: 2,
          settlementMethod: "card",
          signedSalesDelta: -200,
          signedSettlementAmount: -200,
          transactionId: "prior-day-txn",
        },
      ],
      completedTransactions: [{ _id: "txn-1" }] as never,
      currentDayCashTotal: 10_000,
      salesTotal: 20_000,
    });

    expect(totals).toMatchObject({
      adjustedSalesTotal: 20_500,
      adjustmentCashSettlementTotal: 500,
      adjustmentCollectionTotal: 500,
      adjustmentNetSettlementTotal: 300,
      adjustmentRefundTotal: 200,
      itemAdjustmentCount: 2,
      netCashMovementTotal: 10_500,
    });
    expect(totals.adjustmentPaymentTotals).toEqual([
      { method: "cash", amount: 500, transactionCount: 1 },
      { method: "card", amount: -200, transactionCount: 1 },
    ]);
  });
});
