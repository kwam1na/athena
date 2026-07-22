import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  SHARED_DEMO_OPENING_MESSAGE,
  SHARED_DEMO_PICKUP_ORDER,
  SHARED_DEMO_PRODUCTS,
  SHARED_DEMO_STAFF_STORY,
  SHARED_DEMO_STORE_IDENTITY,
  sharedDemoProductImageUrl,
  sharedDemoPickupOrderAmount,
  sharedDemoPickupOrderTimeline,
} from "../../shared/sharedDemoStory";
import {
  calculateSharedDemoExpectedCash,
  buildSharedDemoContinuityMigrationStatePatch,
  SHARED_DEMO_CASHIER_USERNAME,
  SHARED_DEMO_CASH_SEED,
  SHARED_DEMO_MANAGER_USERNAME,
  SHARED_DEMO_SEED,
  SHARED_DEMO_STAFF_PIN_HASH,
  SHARED_DEMO_PRISTINE_TABLE_COUNTS,
  sharedDemoBootstrapSeedMatches,
  sharedDemoCheckoutSessionMatchesOrder,
  planSharedDemoMigration,
  sharedDemoMigrationSkipTables,
  sharedDemoPristineTableCountsMatch,
  transformSharedDemoCatalogImageBaselineDocument,
  transformSharedDemoStaffStoryBaselineDocument,
  validateSharedDemoSeed,
} from "./provision";
import {
  SHARED_DEMO_BASELINE_VERSION,
  SHARED_DEMO_REGISTER_NUMBER,
} from "./config";

describe("shared demo provisioning", () => {
  it("preserves POS sync continuity through staff story migrations", () => {
    expect(planSharedDemoMigration(16)).toEqual({
      mode: "preserve_operational_continuity",
    });
    expect(planSharedDemoMigration(17)).toEqual({
      mode: "preserve_operational_continuity",
    });
    expect(planSharedDemoMigration(18)).toEqual({
      mode: "preserve_operational_continuity",
    });
    for (const baselineVersion of [11, 12, 13, 14, 15]) {
      expect(planSharedDemoMigration(baselineVersion)).toEqual({
        mode: "reset_operational_state",
      });
    }
    expect(() => planSharedDemoMigration(10)).toThrow(
      "Shared demo baseline migration 10->19 is not registered.",
    );
    expect(buildSharedDemoContinuityMigrationStatePatch(123)).toEqual({
      baselineVersion: 19,
      completedAt: 123,
    });
  });

  it("promotes restored staff identity to the current demo story", () => {
    const ids = { cashier: "cashier-id", manager: "manager-id" };
    expect(transformSharedDemoStaffStoryBaselineDocument({
      tableName: "staffProfile",
      document: { staffCode: "DEMO-001", firstName: "Efua", fullName: "Efua Tetteh", lastName: "Tetteh" },
    }, ids)).toMatchObject({ firstName: "Afua", fullName: "Afua Okyere", lastName: "Okyere" });
    expect(transformSharedDemoStaffStoryBaselineDocument({
      tableName: "staffCredential",
      document: { staffProfileId: ids.cashier, status: "disabled", username: "efua" },
    }, ids)).toMatchObject({ pinHash: SHARED_DEMO_STAFF_PIN_HASH, status: "active", username: "afua" });
    expect(transformSharedDemoStaffStoryBaselineDocument({
      tableName: "staffMessage",
      document: { body: "Efua: Morning studio count is complete." },
    }, ids)).toMatchObject({ body: SHARED_DEMO_OPENING_MESSAGE });
  });

  it("promotes restored catalog images to the current asset version", () => {
    expect(transformSharedDemoCatalogImageBaselineDocument({
      tableName: "productSku",
      document: {
        sku: SHARED_DEMO_PRODUCTS[0]!.sku,
        images: ["https://images.example.com/stores/store-1/products/shared-demo/v1/demo-shea-250.webp"],
      },
    })).toMatchObject({
      images: ["https://images.example.com/stores/store-1/products/shared-demo/v2/demo-shea-250.webp"],
    });
  });

  it("defines one coherent synthetic six-domain narrative", () => {
    expect(validateSharedDemoSeed(SHARED_DEMO_SEED)).toEqual([]);
    expect(SHARED_DEMO_SEED.domains).toEqual([
      "pos", "inventory", "cash", "orders", "staff", "operations",
    ]);
    expect(SHARED_DEMO_SEED.organizationSlug).toBe("demo");
    expect(SHARED_DEMO_SEED.ownerEmail).toBe("store@osustudio.com");
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

    expect(SHARED_DEMO_CASHIER_USERNAME).toBe("afua");
    expect(SHARED_DEMO_MANAGER_USERNAME).toBe("kay");
    expect(SHARED_DEMO_STAFF_PIN_HASH).toBe(expectedPinHash);
    expect(source).toContain("createStaffCredentialWithCtx");
    expect(source).toContain('role: "cashier"');
    expect(source).toContain('role: "manager"');
    expect(source.match(/await ensureDemoStaffAccessWithCtx/g)).toHaveLength(4);
    expect(source.lastIndexOf("await ensureDemoStaffAccessWithCtx")).toBeLessThan(
      source.lastIndexOf("captureBaselineDocumentsWithCtx"),
    );
  });

  it("tells the Osu Studio artisanal story", () => {
    expect(SHARED_DEMO_STORE_IDENTITY.organizationName).toBe("Osu Studio");
    expect(SHARED_DEMO_STORE_IDENTITY.storeName).toBe("Osu Studio — Atelier");
    expect(SHARED_DEMO_STORE_IDENTITY.currency).toBe("GHS");
    expect(SHARED_DEMO_PRODUCTS).toHaveLength(8);
    const kente = SHARED_DEMO_PRODUCTS.find((product) => product.slug === "demo-kente-scarf");
    expect(kente).toMatchObject({ name: "Kente Scarf", price: 35000 });
    const soap = SHARED_DEMO_PRODUCTS.find((product) => product.slug === "demo-black-soap");
    expect(soap).toMatchObject({ name: "Black Soap Bar", price: 3500 });
    expect(SHARED_DEMO_PRODUCTS.map((product) => product.sku)).toEqual([
      "FM5W-7K2-3Q9",
      "FM5W-4HT-8N6",
      "FM5W-9C3-2RD",
      "FM5W-6BX-5W1",
      "FM5W-2MP-7F4",
      "FM5W-8QJ-4K7",
      "FM5W-5K4-9T2",
      "FM5W-3VN-6H8",
    ]);
    expect(
      SHARED_DEMO_PRODUCTS.every((product) =>
        /^[0-9A-Z]{4}-[0-9A-Z]{3}-[0-9A-Z]{3}$/.test(product.sku),
      ),
    ).toBe(true);
    expect(new Set(SHARED_DEMO_PRODUCTS.map((product) => product.sku.split("-")[0])).size).toBe(1);
    expect(new Set(SHARED_DEMO_PRODUCTS.map((product) => product.sku)).size).toBe(8);
    expect(new Set(SHARED_DEMO_PRODUCTS.map((product) => product.slug)).size).toBe(8);
    expect(new Set(SHARED_DEMO_PRODUCTS.map((product) => product.imageFilename)).size).toBe(8);
    expect(
      SHARED_DEMO_PRODUCTS.map((product) =>
        sharedDemoProductImageUrl({
          product,
          publicUrl: "https://images.example.com/",
          storeId: "store-1",
        }),
      ),
    ).toEqual([
      "https://images.example.com/stores/store-1/products/shared-demo/v2/demo-shea-250.webp",
      "https://images.example.com/stores/store-1/products/shared-demo/v2/demo-soap-bar.webp",
      "https://images.example.com/stores/store-1/products/shared-demo/v2/demo-clay-mug.webp",
      "https://images.example.com/stores/store-1/products/shared-demo/v2/demo-bolga-basket.webp",
      "https://images.example.com/stores/store-1/products/shared-demo/v2/demo-soy-candle.webp",
      "https://images.example.com/stores/store-1/products/shared-demo/v2/demo-kente-scarf.webp",
      "https://images.example.com/stores/store-1/products/shared-demo/v2/demo-batik-tote.webp",
      "https://images.example.com/stores/store-1/products/shared-demo/v2/demo-bead-bracelet.webp",
    ]);
    expect(SHARED_DEMO_PRODUCTS.every((product) => product.unitCost < product.price)).toBe(true);
    expect(sharedDemoPickupOrderAmount()).toBe(3500);
    expect(SHARED_DEMO_PICKUP_ORDER.customerEmail).toBe(
      "customer@osustudio.com",
    );
    expect(SHARED_DEMO_PICKUP_ORDER.customerFirstName).toBe("Abena");
    expect(SHARED_DEMO_PICKUP_ORDER.customerLastName).toBe("Owusu");
    expect(SHARED_DEMO_PICKUP_ORDER.customerPhoneNumber).toBe("024 555 0142");
    expect(sharedDemoPickupOrderTimeline(10 * 60 * 60 * 1_000)).toEqual({
      orderReceivedEmailSentAt: 6 * 60 * 60 * 1_000 + 60_000,
      placedAt: 6 * 60 * 60 * 1_000,
    });
    expect(SHARED_DEMO_STAFF_STORY.cashier.fullName).toBe("Afua Okyere");
    expect(SHARED_DEMO_STAFF_STORY.manager.fullName).toBe("Kwabena Agyei");
    expect(SHARED_DEMO_OPENING_MESSAGE.startsWith("Afua:")).toBe(true);
    expect(SHARED_DEMO_REGISTER_NUMBER).toBe("01");
    expect(SHARED_DEMO_BASELINE_VERSION).toBe(19);
  });

  it("seeds the pickup order timeline and received-email state", () => {
    const source = readFileSync("convex/sharedDemo/provision.ts", "utf8");
    expect(source.match(/placedAt: pickupOrderTimeline\.placedAt/g)).toHaveLength(1);
    expect(
      source.match(/pickupOrderTimeline\.orderReceivedEmailSentAt/g),
    ).toHaveLength(1);
    expect(source.match(/didSendConfirmationEmail: true/g)).toHaveLength(1);
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
        images: [sharedDemoProductImageUrl({
          product,
          publicUrl: "https://images.example.com",
          storeId: "store-1",
        })],
        inventoryCount: product.inventoryCount, price: product.price, quantityAvailable: product.inventoryCount,
        sku: product.sku, unitCost: product.unitCost,
      })),
      products: SHARED_DEMO_PRODUCTS.map((product) => ({
        inventoryCount: product.inventoryCount, name: product.name,
        quantityAvailable: product.inventoryCount, slug: product.slug,
      })),
      registerSessions: [{ expectedCash: 5000, openingFloat: 5000, registerNumber: "01", status: "active" }],
      seedEventCount: 1,
      staffCredentials: [
        { pinHash: SHARED_DEMO_STAFF_PIN_HASH, status: "active", username: SHARED_DEMO_CASHIER_USERNAME },
        { pinHash: SHARED_DEMO_STAFF_PIN_HASH, status: "active", username: SHARED_DEMO_MANAGER_USERNAME },
      ],
      staffProfiles: [
        { fullName: "Studio Owner", status: "active" },
        { fullName: "Afua Okyere", staffCode: "DEMO-001", status: "active" },
        { fullName: "Kwabena Agyei", staffCode: "DEMO-002", status: "active" },
      ],
    };
    expect(sharedDemoBootstrapSeedMatches(seed)).toBe(true);
    expect(sharedDemoBootstrapSeedMatches({
      ...seed,
      productSkus: [{ ...seed.productSkus[0]!, quantityAvailable: 7 }, ...seed.productSkus.slice(1)],
    })).toBe(false);
    expect(sharedDemoBootstrapSeedMatches({
      ...seed,
      productSkus: [{ ...seed.productSkus[0]!, images: [] }, ...seed.productSkus.slice(1)],
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
    expect(source).toContain(
      "email: SHARED_DEMO_PICKUP_ORDER.customerEmail",
    );
    expect(source).not.toContain("shared-demo.athena.invalid");
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
    expect(source).toContain(
      'terminal.fingerprintHash === "shared-demo-terminal"',
    );
    expect(source).toContain(
      'terminal.registerNumber === SHARED_DEMO_REGISTER_NUMBER',
    );
    expect(source).toContain("registerNumber: undefined");
  });
});
