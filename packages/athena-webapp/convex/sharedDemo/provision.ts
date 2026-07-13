import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { insertRegisterSessionWithAuthority } from "../operations/registerSessionAuthorityRevision";
import { hashPosTerminalSyncSecret } from "../pos/application/sync/terminalSyncSecret";
import { captureBaselineDocumentsWithCtx } from "./domainRestore";

export const SHARED_DEMO_SEED = {
  version: 1,
  domains: ["pos", "inventory", "cash", "orders", "staff", "operations"],
  organizationSlug: "athena-shared-demo",
  storeSlug: "central",
  ownerEmail: "owner@shared-demo.athena.invalid",
  timeZone: "Africa/Accra",
} as const;

export function validateSharedDemoSeed(seed: typeof SHARED_DEMO_SEED) {
  const errors: string[] = [];
  if (new Set(seed.domains).size !== 6) errors.push("six domains required");
  if (!seed.ownerEmail.endsWith(".invalid")) errors.push("synthetic email required");
  if (!seed.organizationSlug || !seed.storeSlug) errors.push("stable slugs required");
  return errors;
}

function operatingDate(now: number) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit", month: "2-digit", timeZone: SHARED_DEMO_SEED.timeZone, year: "numeric",
  }).format(new Date(now));
}

export const provisionSharedDemo = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const existingOrganization = await ctx.db.query("organization").withIndex("by_slug", (q) => q.eq("slug", SHARED_DEMO_SEED.organizationSlug)).unique();
    const existingStore = existingOrganization
      ? await ctx.db.query("store").withIndex("by_organizationId_slug", (q) => q.eq("organizationId", existingOrganization._id).eq("slug", SHARED_DEMO_SEED.storeSlug)).unique()
      : null;
    if (existingOrganization || existingStore) {
      if (!existingOrganization || !existingStore || existingStore.config?.sharedDemo !== true) throw new Error("Shared demo foundation is incomplete.");
      const owner = await ctx.db.query("athenaUser").withIndex("by_normalizedEmail", (q) => q.eq("normalizedEmail", SHARED_DEMO_SEED.ownerEmail)).unique();
      if (!owner) throw new Error("Shared demo owner is missing.");
      return { athenaUserId: owner._id, kind: "existing" as const, organizationId: existingOrganization._id, storeId: existingStore._id };
    }

    const ownerUserId = await ctx.db.insert("athenaUser", {
      email: SHARED_DEMO_SEED.ownerEmail,
      normalizedEmail: SHARED_DEMO_SEED.ownerEmail,
      firstName: "Demo",
      lastName: "Owner",
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: ownerUserId,
      name: "Athena Demo Market",
      slug: SHARED_DEMO_SEED.organizationSlug,
    });
    await ctx.db.patch("athenaUser", ownerUserId, { organizationId });
    await ctx.db.insert("organizationMember", { organizationId, operationalRoles: ["manager"], role: "full_admin", userId: ownerUserId });
    const storeId = await ctx.db.insert("store", {
      config: { sharedDemo: true, timeZone: SHARED_DEMO_SEED.timeZone },
      createdByUserId: ownerUserId,
      currency: "GHS",
      name: "Athena Demo Market — Central",
      organizationId,
      slug: SHARED_DEMO_SEED.storeSlug,
    });
    const ownerStaffId = await ctx.db.insert("staffProfile", {
      createdByUserId: ownerUserId, firstName: "Demo", fullName: "Demo Owner", jobTitle: "Owner",
      lastName: "Owner", linkedUserId: ownerUserId, memberRole: "full_admin", organizationId, status: "active", storeId,
    });
    const cashierStaffId = await ctx.db.insert("staffProfile", {
      createdByUserId: ownerUserId, firstName: "Ama", fullName: "Ama Mensah", jobTitle: "Cashier",
      lastName: "Mensah", memberRole: "pos_only", organizationId, staffCode: "DEMO-001", status: "active", storeId,
    });
    await ctx.db.insert("staffMessage", {
      authorUserId: ownerUserId,
      body: "Ama: Morning stock count is complete. The pickup order is ready at the counter.",
      createdAt: now - 2_700_000,
      organizationId,
      storeId,
      updatedAt: now - 2_700_000,
    });
    const categoryId = await ctx.db.insert("category", { name: "Groceries", showOnStorefront: true, slug: "demo-groceries", storeId });
    const subcategoryId = await ctx.db.insert("subcategory", { categoryId, name: "Dairy", slug: "demo-dairy", storeId });
    const productId = await ctx.db.insert("product", {
      availability: "live", categoryId, createdByUserId: ownerUserId, currency: "GHS", inventoryCount: 24,
      isVisible: true, name: "Fresh Milk 1L", organizationId, posVisible: true, quantityAvailable: 24,
      slug: "demo-fresh-milk", storeId, subcategoryId,
    });
    const productSkuId = await ctx.db.insert("productSku", {
      images: [], inventoryCount: 24, isVisible: true, posVisible: true, price: 2500, productId,
      productName: "Fresh Milk 1L", quantityAvailable: 24, sku: "DEMO-MILK-1L", storeId, unitCost: 1800,
    });
    const terminalId = await ctx.db.insert("posTerminal", {
      browserInfo: { platform: "shared_demo", userAgent: "Athena Shared Demo" }, displayName: "Demo Front Register",
      fingerprintHash: "shared-demo-terminal", heartbeatEnabled: false, loginMode: "pos_only", registerNumber: "DEMO-01",
      registeredAt: now, registeredByUserId: ownerUserId, status: "active", storeId,
      syncSecretHash: await hashPosTerminalSyncSecret("shared-demo-non-secret-terminal-seed"), transactionCapability: "products_and_services",
    });
    const registerSessionId = await insertRegisterSessionWithAuthority(ctx, {
      expectedCash: 32500, openedAt: now - 14_400_000, openedByStaffProfileId: cashierStaffId,
      openedByUserId: ownerUserId, openedOperatingDate: operatingDate(now), openingFloat: 30000,
      organizationId, registerNumber: "DEMO-01", status: "active", storeId, terminalId,
    });
    const transactionId = await ctx.db.insert("posTransaction", {
      completedAt: now - 3_600_000, paymentMethod: "cash", payments: [{ amount: 5000, method: "cash", timestamp: now - 3_600_000 }],
      registerNumber: "DEMO-01", registerSessionId, staffProfileId: cashierStaffId, status: "completed", storeId,
      subtotal: 5000, tax: 0, total: 5000, totalPaid: 5000, transactionNumber: "DEMO-SALE-001",
    });
    await ctx.db.insert("posTransactionItem", { productId, productName: "Fresh Milk 1L", productSku: "DEMO-MILK-1L", productSkuId, quantity: 2, totalPrice: 5000, transactionId, unitPrice: 2500 });
    await ctx.db.insert("inventoryMovement", {
      actorStaffProfileId: cashierStaffId, afterOnHandQuantity: 24, beforeOnHandQuantity: 26,
      businessEventKey: "shared-demo:seed:sale", createdAt: now - 3_600_000, movementType: "sale",
      occurrenceAt: now - 3_600_000, organizationId, posTransactionId: transactionId, productId, productSkuId,
      quantityDelta: -2, registerSessionId, sourceId: String(transactionId), sourceType: "pos_transaction", storeId,
    });
    await ctx.db.insert("posRegisterSessionActivity", {
      acceptedAt: now - 3_600_000, activityKey: "shared-demo:cash:opening", category: "cash", eventType: "cash.deposit",
      localEventId: "shared-demo-cash-1", localRegisterSessionId: "shared-demo-register", localSequence: 1,
      metadata: { amount: 2500, note: "Midday cash deposit" }, occurredAt: now - 3_600_000,
      projectedAt: now - 3_600_000, receivedAt: now - 3_600_000, registerNumber: "DEMO-01", registerSessionId,
      reportedAt: now - 3_600_000, staffProfileId: cashierStaffId, status: "projected", storeId, terminalId, updatedAt: now - 3_600_000,
    });
    const guestId = await ctx.db.insert("guest", { creationOrigin: "shared_demo", marker: "shared-demo-customer", organizationId, storeId });
    const bagId = await ctx.db.insert("bag", { items: [], storeFrontUserId: guestId, storeId, updatedAt: now });
    const checkoutSessionId = await ctx.db.insert("checkoutSession", {
      amount: 2500, bagId, billingDetails: null, customerDetails: null, deliveryDetails: null, deliveryFee: 0,
      deliveryInstructions: null, deliveryMethod: "pickup", deliveryOption: null, discount: null, expiresAt: now + 86_400_000,
      hasCompletedCheckoutSession: true, hasCompletedPayment: false, hasVerifiedPayment: false, isFinalizingPayment: false,
      isPODOrder: true, pickupLocation: "Demo counter", storeFrontUserId: guestId, storeId,
    });
    const orderId = await ctx.db.insert("onlineOrder", {
      amount: 2500, bagId, billingDetails: null, checkoutSessionId,
      customerDetails: { email: "customer@shared-demo.athena.invalid", firstName: "Demo", lastName: "Customer", phoneNumber: "0000000000" },
      deliveryDetails: null, deliveryFee: 0, deliveryInstructions: null, deliveryMethod: "pickup", deliveryOption: null,
      discount: null, hasVerifiedPayment: false, isPODOrder: true, orderNumber: "DEMO-ORDER-001",
      paymentCollected: false, paymentDue: 2500, paymentMethod: { channel: "cash", podPaymentMethod: "cash", type: "payment_on_delivery" },
      pickupLocation: "Demo counter", podPaymentMethod: "cash", readyAt: now - 1_800_000, status: "ready",
      storeFrontUserId: guestId, storeId, updatedAt: now,
    });
    await ctx.db.patch("checkoutSession", checkoutSessionId, { placedOrderId: orderId });
    await ctx.db.insert("onlineOrderItem", { isReady: true, orderId, price: 2500, productId, productName: "Fresh Milk 1L", productSku: "DEMO-MILK-1L", productSkuId, quantity: 1, storeFrontUserId: guestId });
    const dailyOpeningId = await ctx.db.insert("dailyOpening", {
      acknowledgedItemKeys: [], actorStaffProfileId: ownerStaffId, actorType: "human", actorUserId: ownerUserId,
      carryForwardWorkItemIds: [], createdAt: now, operatingDate: operatingDate(now), organizationId,
      readiness: { blockerCount: 0, carryForwardCount: 0, readyCount: 4, reviewCount: 1, status: "ready" },
      sourceSubjects: [{ id: String(storeId), label: "Athena Demo Market — Central", type: "store" }],
      startedAt: now - 14_400_000, status: "started", storeId, updatedAt: now,
    });
    await ctx.db.insert("operationalEvent", {
      actorStaffProfileId: ownerStaffId, actorType: "human", actorUserId: ownerUserId, createdAt: now - 14_400_000,
      eventType: "demo.store_day_started", message: "The shared demo store opened for the operating day.", organizationId,
      subjectId: String(dailyOpeningId), subjectLabel: operatingDate(now), subjectType: "daily_opening", storeId,
    });
    await ctx.db.insert("sharedDemoRestoreState", { baselineVersion: 1, completedAt: now, epoch: 0, status: "ready", storeId });
    await captureBaselineDocumentsWithCtx(ctx, { storeId });
    return { athenaUserId: ownerUserId, kind: "created" as const, organizationId, storeId };
  },
});
