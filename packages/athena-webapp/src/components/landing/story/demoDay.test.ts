import { describe, expect, it } from "vitest";

import { SHARED_DEMO_PRODUCTS } from "~/shared/sharedDemoStory";
import {
  bridgeActivity,
  cashDashboardSnapshot,
  eodSnapshot,
  morningPaymentMix,
  morningPulseSummary,
  morningTopItems,
  posCartLines,
} from "./demoDayFixtures";
import {
  carryForward,
  dayTotals,
  drawer,
  formatDemoMoney,
  morningSnapshot,
  payments,
  topItems,
  tracedSale,
} from "./demoDay";

describe("landing demo day continuity", () => {
  it("prices the traced sale from the shared demo catalog", () => {
    for (const item of tracedSale.items) {
      const product = SHARED_DEMO_PRODUCTS.find((entry) => entry.name === item.name);
      expect(product, item.name).toBeDefined();
      expect(item.price).toBe(product!.price);
    }
    expect(tracedSale.total).toBe(
      tracedSale.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    );
    expect(formatDemoMoney(tracedSale.total)).toBe("GH₵385");
  });

  it("builds the drawer's expected cash from the float and cash payments", () => {
    expect(drawer.expectedCash).toBe(drawer.openingFloat + payments.cash);
    expect(drawer.expectedAfterSale - drawer.expectedBeforeSale).toBe(tracedSale.total);
    expect(drawer.expectedAfterSale).toBeLessThanOrEqual(drawer.expectedCash);
    expect(drawer.variance).toBe(drawer.countedCash - drawer.expectedCash);
    expect(drawer.depositAmount).toBeLessThanOrEqual(drawer.countedCash);
  });

  it("sums the payment split to net sales and keeps the morning inside the day", () => {
    expect(dayTotals.netSales).toBe(payments.cash + payments.card + payments.mobileMoney);
    expect(morningSnapshot.netSales).toBeLessThan(dayTotals.netSales);
    expect(morningSnapshot.transactions).toBeLessThan(dayTotals.transactions);
    expect(morningSnapshot.itemsSold).toBeLessThan(dayTotals.itemsSold);
  });

  it("keeps top items and carry-forward honest against the catalog", () => {
    let topItemsTotal = 0;
    let topItemsQuantity = 0;
    for (const item of topItems) {
      const product = SHARED_DEMO_PRODUCTS.find((entry) => entry.name === item.name);
      expect(product, item.name).toBeDefined();
      expect(item.total).toBe(product!.price * item.quantity);
      topItemsTotal += item.total;
      topItemsQuantity += item.quantity;
    }
    expect(topItemsTotal).toBeLessThanOrEqual(dayTotals.netSales);
    expect(topItemsQuantity).toBeLessThanOrEqual(dayTotals.itemsSold);
    const kente = SHARED_DEMO_PRODUCTS.find((entry) => entry.slug === "demo-kente-scarf");
    const kenteSold = topItems.find((item) => item.name === kente!.name)!.quantity;
    expect(carryForward.remaining).toBe(kente!.inventoryCount - kenteSold);
  });

  it("keeps the real-component fixtures reconciled with the story day", () => {
    // Daily Operations: the morning pulse fixture matches the morning snapshot.
    expect(morningPulseSummary.totalSales).toBe(morningSnapshot.netSales);
    expect(
      morningPaymentMix.reduce((sum, entry) => sum + entry.total, 0),
    ).toBe(morningSnapshot.netSales);
    expect(
      morningPaymentMix.reduce((sum, entry) => sum + entry.count, 0),
    ).toBe(morningSnapshot.transactions);
    expect(
      morningPaymentMix.reduce((sum, entry) => sum + entry.share, 0),
    ).toBe(100);
    for (const item of morningTopItems) {
      const product = SHARED_DEMO_PRODUCTS.find((entry) => entry.sku === item.productSku);
      expect(product, item.productSku).toBeDefined();
      expect(item.totalSales).toBe(product!.price * item.quantity);
    }
    const trend = morningPulseSummary.operatorSnapshot!.trend;
    expect(trend[trend.length - 1]!.totalSales).toBe(morningSnapshot.netSales);

    // POS: the cart fixture is exactly the traced sale.
    expect(posCartLines.map((line) => ({ name: line.name, price: line.price }))).toEqual(
      tracedSale.items.map((item) => ({ name: item.name, price: item.price })),
    );

    // Bridge: the traced sale appears as a projected activity row.
    const saleRow = bridgeActivity.page.find((row) => row.category === "sale");
    expect(saleRow).toBeDefined();
    expect(saleRow!.status.kind).toBe("projected");
    expect(bridgeActivity.summary.rowCount).toBe(bridgeActivity.page.length);

    // Cash Controls: the dashboard session carries the drawer economics.
    const [session] = cashDashboardSnapshot.registerSessions;
    expect(session!.expectedCash).toBe(drawer.expectedCash);
    expect(session!.countedCash).toBe(drawer.countedCash);
    expect(session!.variance).toBe(drawer.variance);
    expect(session!.totalDeposited).toBe(drawer.depositAmount);

    // EOD: payment totals sum to net sales; the variance matches the drawer.
    expect(
      eodSnapshot.summary.paymentTotals!.reduce((sum, entry) => sum + entry.amount, 0),
    ).toBe(dayTotals.netSales);
    expect(eodSnapshot.summary.netCashVariance).toBe(drawer.variance);
    expect(eodSnapshot.readiness!.carryForwardCount).toBe(eodSnapshot.carryForwardItems.length);
  });
});
