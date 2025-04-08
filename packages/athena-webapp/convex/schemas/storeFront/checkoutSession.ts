import { v } from "convex/values";

export const paymentMethodSchema = v.object({
  last4: v.optional(v.string()),
  brand: v.optional(v.string()),
  bank: v.optional(v.string()),
  channel: v.optional(v.string()),
});

export const checkoutSessionSchema = v.object({
  storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  placedOrderId: v.optional(v.id("onlineOrder")),
  storeId: v.id("store"),
  bagId: v.id("bag"),
  amount: v.number(),
  expiresAt: v.number(),
  isFinalizingPayment: v.boolean(),
  deliveryInstructions: v.union(v.string(), v.null()),
  externalReference: v.optional(v.string()),
  externalTransactionId: v.optional(v.string()),
  hasCompletedPayment: v.boolean(),
  hasCompletedCheckoutSession: v.boolean(),
  hasVerifiedPayment: v.boolean(),
  isPaymentRefunded: v.optional(v.boolean()),
  paymentMethod: v.optional(paymentMethodSchema),
  billingDetails: v.union(v.record(v.string(), v.any()), v.null()),
  customerDetails: v.union(v.record(v.string(), v.any()), v.null()),
  deliveryDetails: v.union(v.record(v.string(), v.any()), v.null(), v.string()),
  deliveryMethod: v.optional(
    v.union(v.literal("delivery"), v.literal("pickup"))
  ),
  deliveryOption: v.union(v.string(), v.null()),
  deliveryFee: v.union(v.number(), v.null()),
  discount: v.union(v.record(v.string(), v.any()), v.null()),
  pickupLocation: v.union(v.string(), v.null()),
});
