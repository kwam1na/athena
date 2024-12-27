import { v } from "convex/values";
import { paymentMethodSchema } from "../checkoutSession";
import { onlineOrderItemSchema } from "./onlineOrderItem";

export const addressSchema = v.object({
  address: v.string(),
  city: v.string(),
  state: v.optional(v.string()),
  zip: v.optional(v.string()),
  country: v.string(),
  region: v.optional(v.string()),
});

export const customerDetailsSchema = v.object({
  firstName: v.string(),
  lastName: v.string(),
  email: v.string(),
  phoneNumber: v.string(),
});

export const orderDetailsSchema = v.object({
  billingDetails: addressSchema,
  customerDetails: customerDetailsSchema,
  deliveryDetails: v.union(addressSchema, v.null()),
  deliveryMethod: v.string(),
  deliveryOption: v.union(v.string(), v.null()),
  deliveryFee: v.union(v.number(), v.null()),
  pickupLocation: v.union(v.string(), v.null()),
});

export const onlineOrderSchema = v.object({
  customerId: v.union(v.id("customer"), v.id("guest")),
  storeId: v.id("store"),
  checkoutSessionId: v.id("checkoutSession"),
  externalReference: v.optional(v.string()),
  externalTransactionId: v.optional(v.string()),
  bagId: v.id("bag"),
  amount: v.number(),
  billingDetails: addressSchema,
  customerDetails: customerDetailsSchema,
  deliveryDetails: v.union(addressSchema, v.null()),
  deliveryMethod: v.string(),
  deliveryOption: v.union(v.string(), v.null()),
  deliveryFee: v.union(v.number(), v.null()),
  pickupLocation: v.union(v.string(), v.null()),
  hasVerifiedPayment: v.boolean(),
  paymentMethod: v.optional(paymentMethodSchema),
  orderNumber: v.string(),
  status: v.string(),
  items: v.optional(v.array(onlineOrderItemSchema)),
  transitions: v.optional(
    v.array(v.object({ status: v.string(), date: v.number() }))
  ),
  readyAt: v.optional(v.number()),
  refunds: v.optional(
    v.array(v.object({ amount: v.number(), id: v.string() }))
  ),
});
