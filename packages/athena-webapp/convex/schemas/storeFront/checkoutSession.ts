import { v } from "convex/values";
import {
  addressSchema,
  customerDetailsSchema,
} from "./onlineOrder/onlineOrder";
// import {
//   addressSchema,
//   customerDetailsSchema,
// } from "./onlineOrder/onlineOrder";

export const paymentMethodSchema = v.object({
  last4: v.optional(v.string()),
  brand: v.optional(v.string()),
  bank: v.optional(v.string()),
  channel: v.optional(v.string()),
});

export const checkoutSessionSchema = v.object({
  customerId: v.union(v.id("customer"), v.id("guest")),
  placedOrderId: v.optional(v.id("onlineOrder")),
  storeId: v.id("store"),
  bagId: v.id("bag"),
  amount: v.number(),
  expiresAt: v.number(),
  isFinalizingPayment: v.boolean(),
  externalReference: v.optional(v.string()),
  externalTransactionId: v.optional(v.string()),
  hasCompletedPayment: v.boolean(),
  hasCompletedCheckoutSession: v.boolean(),
  hasVerifiedPayment: v.boolean(),
  paymentMethod: v.optional(paymentMethodSchema),
  billingDetails: v.union(v.record(v.string(), v.any()), v.null()),
  customerDetails: v.union(v.record(v.string(), v.any()), v.null()),
  deliveryDetails: v.union(v.record(v.string(), v.any()), v.null()),
  deliveryMethod: v.optional(v.string()),
  deliveryOption: v.union(v.string(), v.null()),
  deliveryFee: v.union(v.number(), v.null()),
  pickupLocation: v.union(v.string(), v.null()),
});
