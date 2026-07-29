/// <reference types="vite/client" />

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Shared domain seeding for the slice F tests (`reseed.test.ts`,
 * `verify.test.ts`).
 *
 * Both suites need the same non-trivial fixture — a store with POS,
 * storefront, service, payment and close activity — and the reseed/verify pair
 * only proves anything when both are looking at IDENTICAL source rows. One
 * builder makes that a property of the tests rather than a coincidence.
 *
 * This file seeds DOMAIN tables only. It never touches a `report*` table:
 * everything under test has to arrive through `reseedStep`.
 */

export type SeededStore = {
  organizationId: Id<"organization">;
  storeId: Id<"store">;
  userId: Id<"athenaUser">;
  guestId: Id<"guest">;
  productId: Id<"product">;
  skuId: Id<"productSku">;
  otherSkuId: Id<"productSku">;
};

export async function seedStore(
  ctx: MutationCtx,
  timezone?: string,
): Promise<SeededStore> {
  const userId = await ctx.db.insert("athenaUser", {
    email: "admin@example.test",
  });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: userId,
    name: "Org",
    slug: "org",
  });
  const storeId = await ctx.db.insert("store", {
    ...(timezone ? { config: { timezone } } : {}),
    createdByUserId: userId,
    currency: "GHS",
    name: "Store",
    organizationId,
    slug: "store",
  });
  const guestId = await ctx.db.insert("guest", {});
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
  const insertSku = (sku: string) =>
    ctx.db.insert("productSku", {
      attributes: {},
      images: [],
      inventoryCount: 0,
      price: 100,
      productId,
      quantityAvailable: 0,
      sku,
      storeId,
    });

  return {
    guestId,
    organizationId,
    otherSkuId: await insertSku("SKU-B"),
    productId,
    skuId: await insertSku("SKU-A"),
    storeId,
    userId,
  };
}

/** A POS transaction with line items. Amounts are pesewas. */
export async function seedPosSale(
  ctx: MutationCtx,
  seeded: SeededStore,
  args: {
    completedAt: number;
    lines: Array<{
      productSkuId?: Id<"productSku">;
      quantity: number;
      unitPrice: number;
    }>;
    status?: string;
    tax?: number;
    transactionNumber: string;
    voidedAt?: number;
  },
): Promise<Id<"posTransaction">> {
  const subtotal = args.lines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0,
  );
  const tax = args.tax ?? 0;
  const transactionId = await ctx.db.insert("posTransaction", {
    completedAt: args.completedAt,
    payments: [
      { amount: subtotal + tax, method: "cash", timestamp: args.completedAt },
    ],
    status: args.status ?? "completed",
    storeId: seeded.storeId,
    subtotal,
    tax,
    total: subtotal + tax,
    totalPaid: subtotal + tax,
    transactionNumber: args.transactionNumber,
    ...(args.voidedAt !== undefined ? { voidedAt: args.voidedAt } : {}),
  });

  for (const line of args.lines) {
    await ctx.db.insert("posTransactionItem", {
      productId: seeded.productId,
      productName: "Product",
      productSku: "SKU-A",
      productSkuId: line.productSkuId ?? seeded.skuId,
      quantity: line.quantity,
      totalPrice: line.unitPrice * line.quantity,
      transactionId,
      unitPrice: line.unitPrice,
    });
  }

  return transactionId;
}

/** An applied POS correction with one adjustment line. */
export async function seedPosCorrection(
  ctx: MutationCtx,
  seeded: SeededStore,
  args: {
    appliedAt: number;
    correctedTotal: number;
    originalTotal: number;
    quantityDelta: number;
    transactionId: Id<"posTransaction">;
  },
): Promise<Id<"posTransactionAdjustment">> {
  const deltaTotal = args.correctedTotal - args.originalTotal;
  const adjustmentId = await ctx.db.insert("posTransactionAdjustment", {
    appliedAt: args.appliedAt,
    correctedSubtotal: args.correctedTotal,
    correctedTax: 0,
    correctedTotal: args.correctedTotal,
    createdAt: args.appliedAt,
    deltaTotal,
    originalSubtotal: args.originalTotal,
    originalTax: 0,
    originalTotal: args.originalTotal,
    payloadFingerprint: `fp-${args.transactionId}-${args.appliedAt}`,
    payloadSubject: "items",
    settlementAmount: Math.abs(deltaTotal),
    settlementDirection: deltaTotal >= 0 ? "collect" : "refund",
    status: "applied",
    storeId: seeded.storeId,
    transactionId: args.transactionId,
    updatedAt: args.appliedAt,
  });

  await ctx.db.insert("posTransactionAdjustmentLine", {
    adjustmentId,
    correctedQuantity: Math.max(0, args.quantityDelta),
    correctedTotal: args.correctedTotal,
    createdAt: args.appliedAt,
    inventoryDelta: -args.quantityDelta,
    lineType: "existing",
    originalQuantity: 0,
    originalTotal: args.originalTotal,
    productId: seeded.productId,
    productName: "Product",
    productSku: "SKU-A",
    productSkuId: seeded.skuId,
    quantityDelta: args.quantityDelta,
    storeId: seeded.storeId,
    transactionId: args.transactionId,
    unitPrice: 0,
  });

  return adjustmentId;
}

/** A fulfilled online order with stored item rows. */
export async function seedOnlineOrder(
  ctx: MutationCtx,
  seeded: SeededStore,
  args: {
    completedAt: number;
    deliveryFee?: number;
    discountTotal?: number;
    items: Array<{
      price: number;
      productSkuId?: Id<"productSku">;
      quantity: number;
    }>;
    orderNumber: string;
    refunds?: Array<{ amount: number; date: number; id: string }>;
    status?: string;
  },
): Promise<Id<"onlineOrder">> {
  const amount = args.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const bagId = await ctx.db.insert("bag", {
    items: [],
    storeFrontUserId: seeded.guestId,
    storeId: seeded.storeId,
    updatedAt: args.completedAt,
  });
  const checkoutSessionId = await ctx.db.insert("checkoutSession", {
    amount,
    bagId,
    billingDetails: null,
    customerDetails: null,
    deliveryDetails: null,
    deliveryFee: args.deliveryFee ?? null,
    deliveryInstructions: null,
    deliveryOption: null,
    discount: null,
    expiresAt: args.completedAt + 1_000,
    hasCompletedCheckoutSession: true,
    hasCompletedPayment: true,
    hasVerifiedPayment: true,
    isFinalizingPayment: false,
    pickupLocation: null,
    storeFrontUserId: seeded.guestId,
    storeId: seeded.storeId,
  });

  const orderId = await ctx.db.insert("onlineOrder", {
    amount,
    bagId,
    billingDetails: null,
    checkoutSessionId,
    completedAt: args.completedAt,
    customerDetails: {
      email: "customer@example.test",
      firstName: "Ama",
      lastName: "Mensah",
      phoneNumber: "+233000000000",
    },
    deliveryDetails: null,
    deliveryFee: args.deliveryFee ?? null,
    deliveryInstructions: null,
    deliveryMethod: "pickup",
    deliveryOption: null,
    discount:
      args.discountTotal === undefined
        ? null
        : { totalDiscount: args.discountTotal },
    hasVerifiedPayment: true,
    orderNumber: args.orderNumber,
    pickupLocation: null,
    ...(args.refunds ? { refunds: args.refunds } : {}),
    status: args.status ?? "delivered",
    storeFrontUserId: seeded.guestId,
    storeId: seeded.storeId,
    updatedAt: args.completedAt,
  });

  for (const item of args.items) {
    await ctx.db.insert("onlineOrderItem", {
      orderId,
      price: item.price,
      productId: seeded.productId,
      productSku: "SKU-A",
      productSkuId: item.productSkuId ?? seeded.skuId,
      quantity: item.quantity,
      storeFrontUserId: seeded.guestId,
    });
  }

  return orderId;
}

/** A recorded payment allocation. `direction: "out"` makes it a refund. */
export async function seedPaymentAllocation(
  ctx: MutationCtx,
  seeded: SeededStore,
  args: {
    amount: number;
    direction?: "in" | "out";
    recordedAt: number;
    status?: "recorded" | "voided";
    targetId: string;
  },
): Promise<Id<"paymentAllocation">> {
  return await ctx.db.insert("paymentAllocation", {
    allocationType: "payment",
    amount: args.amount,
    collectedInStore: true,
    currency: "GHS",
    direction: args.direction ?? "in",
    method: "cash",
    organizationId: seeded.organizationId,
    recordedAt: args.recordedAt,
    status: args.status ?? "recorded",
    storeId: seeded.storeId,
    targetId: args.targetId,
    targetType: "pos_transaction",
  });
}

/** A completed service case with billed lines. */
export async function seedServiceCase(
  ctx: MutationCtx,
  seeded: SeededStore,
  args: {
    completedAt: number;
    lines: Array<{ amount: number; quantity: number }>;
  },
): Promise<Id<"serviceCase">> {
  const totalAmount = args.lines.reduce((sum, line) => sum + line.amount, 0);
  const customerProfileId = await ctx.db.insert("customerProfile", {
    fullName: "Ama Mensah",
    organizationId: seeded.organizationId,
    status: "active",
    storeId: seeded.storeId,
  });
  const operationalWorkItemId = await ctx.db.insert("operationalWorkItem", {
    approvalState: "not_required",
    createdAt: args.completedAt,
    organizationId: seeded.organizationId,
    priority: "normal",
    status: "open",
    storeId: seeded.storeId,
    title: "Service case",
    type: "service_case",
  });

  const serviceCaseId = await ctx.db.insert("serviceCase", {
    balanceDueAmount: 0,
    completedAt: args.completedAt,
    createdAt: args.completedAt,
    customerProfileId,
    lastStatusChangedAt: args.completedAt,
    operationalWorkItemId,
    organizationId: seeded.organizationId,
    paymentStatus: "paid",
    serviceMode: "repair",
    status: "completed",
    storeId: seeded.storeId,
    totalAmount,
    updatedAt: args.completedAt,
  });

  for (const line of args.lines) {
    await ctx.db.insert("serviceCaseLineItem", {
      amount: line.amount,
      createdAt: args.completedAt,
      description: "Labor",
      lineType: "labor",
      quantity: line.quantity,
      serviceCaseId,
      unitPrice: line.amount / Math.max(1, line.quantity),
    });
  }

  return serviceCaseId;
}

/** A completed (accepted) daily close. */
export async function seedDailyClose(
  ctx: MutationCtx,
  seeded: SeededStore,
  args: {
    completedAt: number;
    operatingDate: string;
    salesTotal: number;
    lifecycleStatus?: "active" | "reopened" | "superseded";
  },
): Promise<Id<"dailyClose">> {
  return await ctx.db.insert("dailyClose", {
    carryForwardWorkItemIds: [],
    completedAt: args.completedAt,
    createdAt: args.completedAt,
    isCurrent: true,
    ...(args.lifecycleStatus ? { lifecycleStatus: args.lifecycleStatus } : {}),
    operatingDate: args.operatingDate,
    organizationId: seeded.organizationId,
    readiness: {
      blockerCount: 0,
      carryForwardCount: 0,
      readyCount: 1,
      reviewCount: 0,
      status: "ready",
    },
    sourceSubjects: [],
    status: "completed",
    storeId: seeded.storeId,
    summary: { salesTotal: args.salesTotal },
    updatedAt: args.completedAt,
  });
}

/** A purchase-order receipt (receiving batch with embedded lines). */
export async function seedReceivingBatch(
  ctx: MutationCtx,
  seeded: SeededStore,
  args: {
    confirmedUnitCost?: number;
    receivedAt: number;
    receivedQuantity: number;
    unitCost: number;
  },
): Promise<Id<"receivingBatch">> {
  const vendorId = await ctx.db.insert("vendor", {
    createdAt: args.receivedAt,
    lookupKey: "vendor",
    name: "Vendor",
    status: "active",
    storeId: seeded.storeId,
  });
  const purchaseOrderId = await ctx.db.insert("purchaseOrder", {
    createdAt: args.receivedAt,
    currency: "GHS",
    lineItemCount: 1,
    poNumber: "PO-1",
    status: "received",
    storeId: seeded.storeId,
    subtotalAmount: args.unitCost * args.receivedQuantity,
    totalAmount: args.unitCost * args.receivedQuantity,
    totalUnits: args.receivedQuantity,
    vendorId,
  });
  const purchaseOrderLineItemId = await ctx.db.insert("purchaseOrderLineItem", {
    createdAt: args.receivedAt,
    lineTotal: args.unitCost * args.receivedQuantity,
    orderedQuantity: args.receivedQuantity,
    productId: seeded.productId,
    productSkuId: seeded.skuId,
    purchaseOrderId,
    receivedQuantity: args.receivedQuantity,
    storeId: seeded.storeId,
    unitCost: args.unitCost,
  });

  return await ctx.db.insert("receivingBatch", {
    createdAt: args.receivedAt,
    lineItems: [
      {
        ...(args.confirmedUnitCost !== undefined
          ? { confirmedCurrency: "GHS", confirmedUnitCost: args.confirmedUnitCost }
          : {}),
        productSkuId: seeded.skuId,
        purchaseOrderLineItemId,
        receivedQuantity: args.receivedQuantity,
      },
    ],
    lineItemCount: 1,
    organizationId: seeded.organizationId,
    purchaseOrderId,
    receivedAt: args.receivedAt,
    storeId: seeded.storeId,
    submissionKey: `recv-${args.receivedAt}`,
    totalUnits: args.receivedQuantity,
  });
}
