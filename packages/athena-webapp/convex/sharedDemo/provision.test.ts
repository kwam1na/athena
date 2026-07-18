import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  SHARED_DEMO_OPENING_MESSAGE,
  SHARED_DEMO_PICKUP_ORDER,
  SHARED_DEMO_PRODUCTS,
  SHARED_DEMO_STAFF_STORY,
  SHARED_DEMO_STORE_IDENTITY,
  sharedDemoPickupOrderAmount,
} from "../../shared/sharedDemoStory";
import {
  calculateSharedDemoExpectedCash,
  SHARED_DEMO_CASHIER_USERNAME,
  SHARED_DEMO_CASH_SEED,
  SHARED_DEMO_MANAGER_USERNAME,
  SHARED_DEMO_SEED,
  SHARED_DEMO_STAFF_PIN_HASH,
  SHARED_DEMO_PRISTINE_TABLE_COUNTS,
  sharedDemoBootstrapSeedMatches,
  sharedDemoCheckoutSessionMatchesOrder,
  sharedDemoMigrationSkipTables,
  sharedDemoPristineTableCountsMatch,
  validateSharedDemoSeed,
} from "./provision";

describe("shared demo provisioning", () => {
  it("defines one coherent synthetic six-domain narrative", () => {
    expect(validateSharedDemoSeed(SHARED_DEMO_SEED)).toEqual([]);
    expect(SHARED_DEMO_SEED.domains).toEqual([
      "pos", "inventory", "cash", "orders", "staff", "operations",
    ]);
    expect(SHARED_DEMO_SEED.organizationSlug).toBe("demo");
    expect(JSON.stringify(SHARED_DEMO_SEED)).not.toMatch(/@gmail|@yahoo|@hotmail/i);
  });

  it("seeds staff communication before capturing the baseline", () => {
    const source = readFileSync("convex/sharedDemo/provision.ts", "utf8");
    expect(source).toContain('ctx.db.insert("staffMessage"');
    expect(source.indexOf('ctx.db.insert("staffMessage"')).toBeLessThan(
      source.lastIndexOf("captureBaselineDocumentsWithCtx"),
    );
  });

  it("seeds active cashier and manager credentials for PIN 1111", () => {
    const source = readFileSync("convex/sharedDemo/provision.ts", "utf8");
    const expectedPinHash = createHash("sha256")
      .update("athena-pos-cashier-pin-salt-v1" + "1111")
      .digest("hex");

    expect(SHARED_DEMO_CASHIER_USERNAME).toBe("efua");
    expect(SHARED_DEMO_MANAGER_USERNAME).toBe("kwabena");
    expect(SHARED_DEMO_STAFF_PIN_HASH).toBe(expectedPinHash);
    expect(source).toContain("createStaffCredentialWithCtx");
    expect(source).toContain('role: "cashier"');
    expect(source).toContain('role: "manager"');
    expect(source.match(/await ensureDemoStaffAccessWithCtx/g)).toHaveLength(3);
    expect(source.lastIndexOf("await ensureDemoStaffAccessWithCtx")).toBeLessThan(
      source.lastIndexOf("captureBaselineDocumentsWithCtx"),
    );
  });

  it("tells the Osu Studio artisanal story", () => {
    expect(SHARED_DEMO_STORE_IDENTITY.organizationName).toBe("Osu Studio");
    expect(SHARED_DEMO_STORE_IDENTITY.storeName).toBe("Osu Studio — Atelier");
    expect(SHARED_DEMO_STORE_IDENTITY.currency).toBe("GHS");
    expect(SHARED_DEMO_PRODUCTS).toHaveLength(8);
    const kente = SHARED_DEMO_PRODUCTS.find((product) => product.sku === "DEMO-KENTE-SCARF");
    expect(kente).toMatchObject({ name: "Kente Scarf", price: 35000 });
    const soap = SHARED_DEMO_PRODUCTS.find((product) => product.sku === "DEMO-SOAP-BAR");
    expect(soap).toMatchObject({ name: "Black Soap Bar", price: 3500 });
    expect(new Set(SHARED_DEMO_PRODUCTS.map((product) => product.sku)).size).toBe(8);
    expect(new Set(SHARED_DEMO_PRODUCTS.map((product) => product.slug)).size).toBe(8);
    expect(SHARED_DEMO_PRODUCTS.every((product) => product.unitCost < product.price)).toBe(true);
    expect(sharedDemoPickupOrderAmount()).toBe(3500);
    expect(SHARED_DEMO_STAFF_STORY.cashier.fullName).toBe("Efua Tetteh");
    expect(SHARED_DEMO_STAFF_STORY.manager.fullName).toBe("Kwabena Osei");
    expect(SHARED_DEMO_OPENING_MESSAGE.startsWith("Efua:")).toBe(true);
  });

  it("refuses to capture a missing-state baseline when marker rows have drifted", () => {
    const orderAmount = sharedDemoPickupOrderAmount();
    const seed = {
      inventoryMovementCount: 0,
      messageBodies: [SHARED_DEMO_OPENING_MESSAGE],
      openingCount: 1,
      orderItems: [{ isReady: true, price: orderAmount, productSku: SHARED_DEMO_PICKUP_ORDER.sku, quantity: 1 }],
      orders: [{ amount: orderAmount, hasVerifiedPayment: true, orderNumber: "DEMO-ORDER-001", paymentDue: orderAmount, status: "ready" }],
      posTransactionCount: 0,
      productSkus: SHARED_DEMO_PRODUCTS.map((product) => ({
        inventoryCount: product.inventoryCount, price: product.price, quantityAvailable: product.inventoryCount,
        sku: product.sku, unitCost: product.unitCost,
      })),
      products: SHARED_DEMO_PRODUCTS.map((product) => ({
        inventoryCount: product.inventoryCount, name: product.name,
        quantityAvailable: product.inventoryCount, slug: product.slug,
      })),
      registerSessions: [{ expectedCash: 5000, openingFloat: 5000, registerNumber: "DEMO-01", status: "active" }],
      seedEventCount: 1,
      staffCredentials: [
        { pinHash: SHARED_DEMO_STAFF_PIN_HASH, status: "active", username: SHARED_DEMO_CASHIER_USERNAME },
        { pinHash: SHARED_DEMO_STAFF_PIN_HASH, status: "active", username: SHARED_DEMO_MANAGER_USERNAME },
      ],
      staffProfiles: [
        { fullName: "Studio Owner", status: "active" },
        { fullName: "Efua Tetteh", staffCode: "DEMO-001", status: "active" },
        { fullName: "Kwabena Osei", staffCode: "DEMO-002", status: "active" },
      ],
    };
    expect(sharedDemoBootstrapSeedMatches(seed)).toBe(true);
    expect(sharedDemoBootstrapSeedMatches({
      ...seed,
      productSkus: [{ ...seed.productSkus[0]!, quantityAvailable: 7 }, ...seed.productSkus.slice(1)],
    })).toBe(false);
    expect(sharedDemoBootstrapSeedMatches({
      ...seed,
      products: seed.products.slice(0, 7),
      productSkus: seed.productSkus.slice(0, 7),
    })).toBe(false);
    expect(sharedDemoBootstrapSeedMatches({ ...seed, posTransactionCount: 1 })).toBe(false);
    expect(sharedDemoBootstrapSeedMatches({
      ...seed,
      staffCredentials: [
        { ...seed.staffCredentials[0]!, failedAuthenticationAttempts: 1 },
        seed.staffCredentials[1]!,
      ],
    })).toBe(false);
    expect(SHARED_DEMO_PRISTINE_TABLE_COUNTS.staffCredential).toBe(2);
    expect(SHARED_DEMO_PRISTINE_TABLE_COUNTS.product).toBe(8);
    expect(SHARED_DEMO_PRISTINE_TABLE_COUNTS.productSku).toBe(8);
    expect(SHARED_DEMO_PRISTINE_TABLE_COUNTS.productSkuSearch).toBe(8);
    expect(sharedDemoPristineTableCountsMatch({
      ...SHARED_DEMO_PRISTINE_TABLE_COUNTS,
    })).toBe(true);
    expect(sharedDemoPristineTableCountsMatch({
      ...SHARED_DEMO_PRISTINE_TABLE_COUNTS,
      approvalRequest: 1,
    })).toBe(false);
    expect(sharedDemoPristineTableCountsMatch({
      ...SHARED_DEMO_PRISTINE_TABLE_COUNTS,
      reportingFact: 1,
    })).toBe(false);
  });

  it("seeds and migrates a completed Opening Handoff", () => {
    const source = readFileSync("convex/sharedDemo/provision.ts", "utf8");
    expect(source).toContain("buildSharedDemoOpeningBaseline");
    expect(source).toContain("buildSharedDemoStoreDayEvent");
    expect(source).toContain("restoreMutableDemoStoreRowsWithCtx");
    expect(source).toContain('ctx.db.delete("dailyOpening"');
  });

  it("keeps durable terminal foundation outside mutable baseline migrations", () => {
    expect(sharedDemoMigrationSkipTables(6)).toEqual(["registerSession"]);
    expect(sharedDemoMigrationSkipTables(2)).toEqual([
      "productSkuSearch",
      "registerSession",
    ]);
    expect(sharedDemoMigrationSkipTables(5)).toEqual(["registerSession"]);
  });

  it("starts the open register with only its $50 opening float", () => {
    const source = readFileSync("convex/sharedDemo/provision.ts", "utf8");

    expect(SHARED_DEMO_CASH_SEED.openingFloat).toBe(5000);
    expect(calculateSharedDemoExpectedCash(SHARED_DEMO_CASH_SEED)).toBe(5000);
    expect(source).not.toContain('ctx.db.insert("posTransaction"');
    expect(source).not.toContain('movementType: "sale"');
    expect(source).not.toContain("Midday cash deposit");
    expect(source).not.toContain('eventType: "cash.deposit"');
  });

  it("seeds a ready pickup order that has already been paid by card", () => {
    const source = readFileSync("convex/sharedDemo/provision.ts", "utf8");

    expect(source).toContain("hasCompletedPayment: true");
    expect(source).toContain("hasVerifiedPayment: true");
    expect(source).toContain('isPODOrder: false');
    expect(source).toContain('channel: "card"');
  });

  it("migrates existing demo baselines to the paid-card order story", () => {
    const source = readFileSync("convex/sharedDemo/provision.ts", "utf8");

    expect(source).toContain("const demoOrder = orders.find(");
    expect(source).toContain('orderNumber === "DEMO-ORDER-001"');
    expect(source).toContain("await ctx.db.patch(\"onlineOrder\", demoOrder._id");
    expect(sharedDemoCheckoutSessionMatchesOrder(
      { placedOrderId: "order-1", storeId: "store-1" },
      { _id: "order-1", storeId: "store-1" },
    )).toBe(true);
    expect(sharedDemoCheckoutSessionMatchesOrder(
      { placedOrderId: "order-1", storeId: "other-store" },
      { _id: "order-1", storeId: "store-1" },
    )).toBe(false);
    expect(sharedDemoCheckoutSessionMatchesOrder(
      { placedOrderId: "other-order", storeId: "store-1" },
      { _id: "order-1", storeId: "store-1" },
    )).toBe(false);
    expect(source).toContain('ctx.db.insert("checkoutSession"');
    expect(source).toContain('ctx.db.patch("checkoutSession", checkoutSessionId');
  });
});
