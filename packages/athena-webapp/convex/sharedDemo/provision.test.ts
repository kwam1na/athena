import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

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

    expect(SHARED_DEMO_CASHIER_USERNAME).toBe("ama");
    expect(SHARED_DEMO_MANAGER_USERNAME).toBe("kofi");
    expect(SHARED_DEMO_STAFF_PIN_HASH).toBe(expectedPinHash);
    expect(source).toContain("createStaffCredentialWithCtx");
    expect(source).toContain('role: "cashier"');
    expect(source).toContain('role: "manager"');
    expect(source.match(/await ensureDemoStaffAccessWithCtx/g)).toHaveLength(3);
    expect(source.lastIndexOf("await ensureDemoStaffAccessWithCtx")).toBeLessThan(
      source.lastIndexOf("captureBaselineDocumentsWithCtx"),
    );
  });

  it("refuses to capture a missing-state baseline when marker rows have drifted", () => {
    const seed = {
      inventoryMovementCount: 0,
      messageBodies: ["Ama: Morning stock count is complete. The pickup order is ready at the counter."],
      openingCount: 1,
      orderItems: [{ isReady: true, price: 2500, productSku: "DEMO-MILK-1L", quantity: 1 }],
      orders: [{ amount: 2500, hasVerifiedPayment: true, orderNumber: "DEMO-ORDER-001", paymentDue: 2500, status: "ready" }],
      posTransactionCount: 0,
      productSkus: [{ inventoryCount: 24, price: 2500, quantityAvailable: 24, sku: "DEMO-MILK-1L", unitCost: 1800 }],
      products: [{ inventoryCount: 24, name: "Fresh Milk 1L", quantityAvailable: 24, slug: "demo-fresh-milk" }],
      registerSessions: [{ expectedCash: 5000, openingFloat: 5000, registerNumber: "DEMO-01", status: "active" }],
      seedEventCount: 1,
      staffCredentials: [
        { pinHash: SHARED_DEMO_STAFF_PIN_HASH, status: "active", username: SHARED_DEMO_CASHIER_USERNAME },
        { pinHash: SHARED_DEMO_STAFF_PIN_HASH, status: "active", username: SHARED_DEMO_MANAGER_USERNAME },
      ],
      staffProfiles: [
        { fullName: "Demo Owner", status: "active" },
        { fullName: "Ama Mensah", staffCode: "DEMO-001", status: "active" },
        { fullName: "Kofi Asante", staffCode: "DEMO-002", status: "active" },
      ],
    };
    expect(sharedDemoBootstrapSeedMatches(seed)).toBe(true);
    expect(sharedDemoBootstrapSeedMatches({
      ...seed,
      productSkus: [{ ...seed.productSkus[0]!, quantityAvailable: 7 }],
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
    expect(source).toContain('ctx.db.insert("dailyOpening"');
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

    expect(source).toContain(
      'hasCompletedPayment: true, hasVerifiedPayment: true',
    );
    expect(source).toContain('isPODOrder: false');
    expect(source).toContain(
      'paymentMethod: { bank: "Demo Bank", brand: "Visa", channel: "card", last4: "4242", type: "online_payment" }',
    );
    expect(source).toContain('hasVerifiedPayment: true, isPODOrder: false');
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
