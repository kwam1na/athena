import { readFileSync } from "node:fs";

// Shared-demo fulfillment limits preserve public order result envelopes.
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { ok } from "../../shared/commandResult";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import {
  getOrderMetrics,
  getReturnExchangeOverview,
  processReturnExchange,
  update,
} from "./onlineOrder";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./storeFront/"),
    loader,
  ]),
);

/** Minimal store/catalog/order graph shared by the reporting-facts tests below. */
async function seedFulfillableOrder(
  ctx: MutationCtx,
  overrides: { deliveryFee?: number } = {},
) {
  const userId = await ctx.db.insert("athenaUser", {
    email: "admin@example.test",
  });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: userId,
    name: "Org",
    slug: "org",
  });
  const storeId = await ctx.db.insert("store", {
    createdByUserId: userId,
    currency: "GHS",
    name: "Store",
    organizationId,
    slug: "store",
  });
  const categoryId = await ctx.db.insert("category", {
    name: "Category",
    slug: "category",
    storeId,
  });
  const subcategoryId = await ctx.db.insert("subcategory", {
    categoryId,
    name: "Subcategory",
    slug: "subcategory",
    storeId,
  });
  const productId = await ctx.db.insert("product", {
    availability: "live",
    categoryId,
    createdByUserId: userId,
    currency: "GHS",
    inventoryCount: 0,
    name: "Product",
    organizationId,
    slug: "product",
    storeId,
    subcategoryId,
  });
  const productSkuId = await ctx.db.insert("productSku", {
    attributes: {},
    images: [],
    inventoryCount: 0,
    price: 5_000,
    productId,
    quantityAvailable: 0,
    sku: "SKU-A",
    storeId,
  });
  const storeFrontUserId = await ctx.db.insert("guest", { storeId });
  const bagId = await ctx.db.insert("bag", {
    items: [],
    storeFrontUserId,
    storeId,
    updatedAt: Date.now(),
  });
  const checkoutSessionId = await ctx.db.insert("checkoutSession", {
    amount: 10_000,
    bagId,
    billingDetails: null,
    customerDetails: null,
    deliveryDetails: null,
    deliveryFee: overrides.deliveryFee ?? 0,
    deliveryOption: null,
    deliveryInstructions: null,
    discount: null,
    expiresAt: Date.now() + 3_600_000,
    hasCompletedCheckoutSession: true,
    hasCompletedPayment: true,
    hasVerifiedPayment: true,
    isFinalizingPayment: false,
    pickupLocation: null,
    storeFrontUserId,
    storeId,
  });
  const orderId = await ctx.db.insert("onlineOrder", {
    amount: 10_000,
    bagId,
    billingDetails: null,
    checkoutSessionId,
    customerDetails: {
      email: "customer@example.test",
      firstName: "Ama",
      lastName: "Owusu",
      phoneNumber: "0000000000",
    },
    deliveryDetails: null,
    deliveryFee: overrides.deliveryFee ?? 0,
    deliveryInstructions: null,
    deliveryMethod: "delivery",
    deliveryOption: null,
    discount: null,
    externalReference: "reference-1",
    hasVerifiedPayment: true,
    orderNumber: "ORD-1",
    pickupLocation: null,
    status: "processing",
    storeId,
    storeFrontUserId,
  });
  const itemId = await ctx.db.insert("onlineOrderItem", {
    orderId,
    price: 5_000,
    productId,
    productSku: "SKU-A",
    productSkuId,
    quantity: 2,
    storeFrontUserId,
  });
  return {
    checkoutSessionId,
    itemId,
    orderId,
    organizationId,
    productId,
    productSkuId,
    storeId,
  };
}

describe("online order internal lookup", () => {
  it("preserves lookup by online order id", async () => {
    const t = convexTest(schema, modules);
    const { orderId } = await t.run((ctx) => seedFulfillableOrder(ctx));

    const order = await t.query(internal.storeFront.onlineOrder.getInternal, {
      identifier: orderId,
    });

    expect(order?._id).toBe(orderId);
  });

  it("preserves lookup by external reference", async () => {
    const t = convexTest(schema, modules);
    const { orderId } = await t.run((ctx) => seedFulfillableOrder(ctx));

    const order = await t.query(internal.storeFront.onlineOrder.getInternal, {
      identifier: "reference-1",
    });

    expect(order?._id).toBe(orderId);
  });

  it("resolves an order by checkout session id", async () => {
    const t = convexTest(schema, modules);
    const { checkoutSessionId, orderId } = await t.run((ctx) =>
      seedFulfillableOrder(ctx),
    );

    const order = await t.query(internal.storeFront.onlineOrder.getInternal, {
      identifier: checkoutSessionId,
    });

    expect(order?._id).toBe(orderId);
  });
});

async function readStorefrontFacts(ctx: MutationCtx, storeId: Id<"store">) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- test-only helper over a tiny seeded fact set.
  const facts = await ctx.db.query("reportFact").collect();
  return facts.filter((fact) => fact.storeId === storeId);
}

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function createUnauthorizedNormalOrderCtx() {
  const order = {
    _id: "order-1",
    orderNumber: "ORDER-1",
    storeId: "store-1",
  };

  return {
    auth: {
      getUserIdentity: vi.fn(async () => ({ subject: "auth-user-1" })),
    },
    db: {
      get: vi.fn(async (table: string, id: string) => {
        if (table === "users" && id === "auth-user-1") {
          return { _id: "auth-user-1", email: "operator@example.com" };
        }
        if (table === "onlineOrder" && id === "order-1") {
          return order;
        }
        if (table === "store" && id === "store-1") {
          return { _id: "store-1", organizationId: "org-1" };
        }
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "athenaUser") {
          return {
            withIndex: vi.fn(() => ({
              first: vi.fn(async () => null),
              take: vi.fn(async () => [
                {
                  _id: "athena-user-1",
                  email: "operator@example.com",
                  normalizedEmail: "operator@example.com",
                },
              ]),
            })),
          };
        }
        if (table === "organizationMember") {
          return {
            withIndex: vi.fn(() => ({
              first: vi.fn(async () => null),
            })),
          };
        }
        if (table === "sharedDemoPrincipal") {
          return {
            withIndex: vi.fn(() => ({
              unique: vi.fn(async () => null),
            })),
          };
        }
        throw new Error(`Unexpected query table: ${table}`);
      }),
    },
  };
}

describe("online order checkout money wiring", () => {
  it("accepts representative admitted public return contracts", () => {
    assertConformsToExportedReturns(update, ok(null));
    assertConformsToExportedReturns(update, {
      kind: "user_error",
      error: {
        code: "not_found",
        message: "Order not found.",
      },
    });
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
    assertConformsToExportedReturns(
      processReturnExchange,
      ok({
        approvalRequestId: "approval-request-1",
        balanceDueAmount: 0,
        message: "Return review requested.",
        refundAmount: 0,
        requiresApproval: true,
        success: true,
      }),
    );
    assertConformsToExportedReturns(getOrderMetrics, {
      grossSales: 0,
      netRevenue: 0,
      totalDiscounts: 0,
      totalOrders: 0,
    });
  });

  it("returns authorization failure when a normal user updates another store's order", async () => {
    const result = await getHandler(update)(
      createUnauthorizedNormalOrderCtx() as never,
      {
        orderId: "order-1",
        update: { status: "cancelled" },
      } as never,
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to this order.",
      },
    });
  });

  it("returns authorization failure when a normal user processes another store's return", async () => {
    const result = await getHandler(processReturnExchange)(
      createUnauthorizedNormalOrderCtx() as never,
      {
        operationType: "return",
        orderId: "order-1",
        restockReturnedItems: false,
        returnItemIds: [],
      } as never,
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to this order.",
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
  it("keeps cross-store demo fulfillment on the typed denial boundary", async () => {
    const source = getSource("./onlineOrder.ts");

    // U7 retired the handler-local `denySharedDemoAction()` /
    // `requireSharedDemoCapability("orders.fulfill")` pair: the SAME typed
    // denial now comes from the admission rail, which resolves the store from
    // the named order before the handler runs.
    expect(source).not.toContain("denySharedDemoAction();");
    expect(source).not.toContain(
      'throw new Error("This action is unavailable in the demo.")',
    );

    const { updateOnlineOrderOperationDefinition } = await import(
      "../operationAdmission/definitions"
    );
    expect(updateOnlineOrderOperationDefinition.capability).toBe(
      "orders.fulfill",
    );
    expect(updateOnlineOrderOperationDefinition.scope).toMatchObject({
      kind: "store",
    });
    expect(
      (updateOnlineOrderOperationDefinition.scope as { resolve?: unknown })
        .resolve,
    ).toBeTypeOf("function");
  });

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

  it("wires first fulfillment and finalized refunds through recordFacts", () => {
    const source = getSource("./onlineOrder.ts");
    const paymentSource = getSource("./payment.ts");

    expect(source).toContain("await recordFacts(ctx, order.storeId, saleFacts);");
    expect(source).toContain("await recordFacts(ctx, order.storeId, refundFacts);");
    expect(source).toContain("await recordFacts(ctx, order.storeId, returnFacts);");
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

describe("online order reporting facts", () => {
  it("records one sale reportFact per fulfilled item on first completion", async () => {
    const t = convexTest(schema, modules);
    const { itemId, orderId, storeId } = await t.run((ctx) =>
      seedFulfillableOrder(ctx, { deliveryFee: 500 }),
    );

    const result = await t.mutation(internal.storeFront.onlineOrder.updateInternal, {
      orderId,
      update: { status: "delivered" },
    });
    expect(result).toEqual({ success: true, message: "Order updated" });

    const facts = await t.run((ctx) => readStorefrontFacts(ctx, storeId));
    const saleFacts = facts.filter((fact) => fact.factKind === "sale");
    // One line per order item, plus one for the delivery fee.
    expect(saleFacts).toHaveLength(2);

    const itemFact = saleFacts.find((fact) => fact.lineId === String(itemId));
    expect(itemFact).toMatchObject({
      currency: "GHS",
      discountAmountMinor: 0,
      grossAmountMinor: 10_000,
      netAmountMinor: 10_000,
      quantity: 2,
      sourceDomain: "storefront",
      sourceId: String(orderId),
      taxAmountMinor: 0,
    });
    expect(itemFact?.productSkuId).toBeDefined();

    const deliveryFact = saleFacts.find((fact) => fact.lineId === "delivery");
    expect(deliveryFact).toMatchObject({
      grossAmountMinor: 500,
      netAmountMinor: 500,
      quantity: 0,
      unitCostMinor: 0,
    });

    // Replaying the same completion must not double the facts (identity is
    // structural on storeId+sourceDomain+sourceId+lineId+factKind).
    await t.mutation(internal.storeFront.onlineOrder.updateInternal, {
      orderId,
      update: { status: "delivered" },
    });
    const replayed = await t.run((ctx) => readStorefrontFacts(ctx, storeId));
    expect(replayed.filter((fact) => fact.factKind === "sale")).toHaveLength(2);
  });

  it("records a money-only refund reportFact with zero quantity", async () => {
    const t = convexTest(schema, modules);
    const { itemId, orderId, storeId } = await t.run((ctx) =>
      seedFulfillableOrder(ctx),
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("onlineOrder", orderId, {
        externalTransactionId: "ext-txn-1",
        refunds: [{ amount: 5_000, date: Date.now(), id: "reservation-1" }],
      });
    });

    const ok = await t.mutation(
      internal.storeFront.onlineOrder.finalizeRefundInternal,
      {
        externalTransactionId: "ext-txn-1",
        onlineOrderItemIds: [itemId],
        refundAmount: 5_000,
        refundId: "refund-1",
        reservationId: "reservation-1",
      },
    );
    expect(ok).toBe(true);

    const facts = await t.run((ctx) => readStorefrontFacts(ctx, storeId));
    const refundFacts = facts.filter(
      (fact) => fact.factKind === "refund" && fact.sourceDomain === "storefront",
    );
    expect(refundFacts).toHaveLength(1);
    expect(refundFacts[0]).toMatchObject({
      currency: "GHS",
      grossAmountMinor: 5_000,
      lineId: `refund-1:${String(itemId)}`,
      netAmountMinor: 5_000,
      quantity: 0,
      sourceDomain: "storefront",
      sourceId: String(orderId),
    });
  });
});
