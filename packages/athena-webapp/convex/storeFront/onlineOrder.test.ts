import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ok } from "../../shared/commandResult";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  getOrderMetrics,
  getReturnExchangeOverview,
  processReturnExchange,
  update,
} from "./onlineOrder";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("online order checkout money wiring", () => {
  it("accepts representative changed public return contracts", () => {
    assertConformsToExportedReturns(update, ok(null));
    assertConformsToExportedReturns(getReturnExchangeOverview, {
      balanceCollectedTotal: 0,
      pendingApprovalCount: 0,
      recentEvents: [],
      refundTotal: 0,
    });
    assertConformsToExportedReturns(
      processReturnExchange,
      ok({
        balanceDueAmount: 0,
        message: "Return recorded.",
        refundAmount: 0,
        requiresApproval: false,
        success: true,
      }),
    );
    assertConformsToExportedReturns(getOrderMetrics, {
      grossSales: 0,
      netRevenue: 0,
      totalDiscounts: 0,
      totalOrders: 0,
    });
    assertConformsToExportedReturns(update, {
      kind: "user_error",
      error: {
        code: "not_found",
        message: "Order not found.",
      },
    });
  });

  it("recomputes order item prices and totals from server SKU data", () => {
    const source = getSource("./helpers/onlineOrder.ts");

    expect(source).toContain("const serverPricedItems = await Promise.all");
    expect(source).toContain('ctx.db.get("productSku", item.productSkuId)');
    expect(source).toContain("const subtotal = calculateItemsSubtotal(serverPricedItems)");
    expect(source).toContain("amount: subtotal");
    expect(source).toContain("serverPricedItems.map((item) =>");
  });

  it("rejects unresolved delivery pricing instead of defaulting to a zero fee", () => {
    const source = getSource("./helpers/onlineOrder.ts");

    expect(source).toContain("if (deliveryFee === null)");
    expect(source).toContain(
      'throw new Error("Delivery details are required before creating an order.")',
    );
    expect(source).not.toContain("}) ?? 0");
  });
});

describe("online order lifecycle workflow tracing", () => {
  it("records order creation traces after checkout session order creation", () => {
    const source = getSource("./helpers/onlineOrder.ts");

    expect(source).toContain('from "../onlineOrderTracing"');
    expect(source).toContain("recordOnlineOrderTraceBestEffort(ctx, {");
    expect(source).toContain('stage: "created"');
    expect(source).toContain("if (createdOrder.hasVerifiedPayment)");
    expect(source).toContain('stage: "paymentVerified"');
  });

  it("records payment and status lifecycle traces from the shared update path", () => {
    const source = getSource("./onlineOrder.ts");

    expect(source).toContain('from "./onlineOrderTracing"');
    expect(source).toContain('stage: "statusChanged"');
    expect(source).toContain('stage: "paymentVerified"');
    expect(source).toContain('stage: "paymentCollected"');
  });

  it("keeps finalized refund trace lookup resolvable by the persisted refund id", () => {
    const source = getSource("./onlineOrderTracing.ts");

    expect(source).toContain('args.stage === "refundFinalized" && args.refundId');
    expect(source).toContain("const safeRefundLookupRef = buildSafeExternalReferenceRef(args.refundId)");
    expect(source).toContain(
      "lookupValue: `${args.order._id}:${safeRefundLookupRef}`",
    );
    expect(source).toContain("traceId: traceSeed.trace.traceId");
  });

  it("recognizes first fulfillment and finalized refunds through reporting ingress", () => {
    const source = getSource("./onlineOrder.ts");
    const paymentSource = getSource("./payment.ts");

    expect(source).toContain("appendReportingIngressWithCtx(ctx, {");
    expect(source).toContain('kind: "storefront_fulfillment"');
    expect(source).toContain('sourceEventType: "storefront_fulfilled"');
    expect(source).toContain('kind: "storefront_refund"');
    expect(source).toContain("refundId: args.refundId");
    expect(source).toContain(
      'sourceEventType: "storefront_refund_finalized"',
    );
    expect(paymentSource).toContain(
      "onlineOrderItemIds: args.onlineOrderItemIds",
    );
  });

  it("attributes finalized refund payments only to the selected SKU lines", () => {
    const source = getSource("./onlineOrder.ts");
    const itemValidationIndex = source.indexOf(
      'throw new Error("Refund item could not be found for this order.")',
    );
    const allocationIndex = source.indexOf(
      "const paymentAllocation = await recordPaymentAllocationWithCtx",
    );

    expect(itemValidationIndex).toBeGreaterThan(-1);
    expect(allocationIndex).toBeGreaterThan(itemValidationIndex);
    expect(source).toContain(
      "selectedRefundItems.map((item) => item.productSkuId)",
    );
    expect(source).toContain("evidenceProductSkuIds: [");
  });
});
