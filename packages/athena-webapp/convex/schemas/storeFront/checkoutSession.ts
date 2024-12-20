import { v } from "convex/values";

export const checkoutSessionSchema = v.object({
  customerId: v.union(v.id("customer"), v.id("guest")),
  storeId: v.id("store"),
  bagId: v.id("bag"),
  amount: v.number(),
  expiresAt: v.number(),
  isFinalizingPayment: v.boolean(),
  externalReference: v.optional(v.string()),
  hasCompletedPayment: v.boolean(),
  hasCompletedCheckoutSession: v.boolean(),
  hasVerifiedPayment: v.boolean(),
});
