import { describe, expect, it } from "vitest";

import { SHARED_DEMO_PRODUCTS } from "~/shared/sharedDemoStory";
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
    const kente = SHARED_DEMO_PRODUCTS.find((entry) => entry.sku === "DEMO-KENTE-SCARF");
    expect(carryForward.remaining).toBe(kente!.inventoryCount - 2);
  });
});
