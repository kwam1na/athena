import { v } from "convex/values";
import { paymentMethodSchema } from "../checkoutSession";
import { onlineOrderItemSchema } from "./onlineOrderItem";

export const addressSchema = v.object({
  address: v.optional(v.string()),
  city: v.optional(v.string()),
  street: v.optional(v.string()),
  landmark: v.optional(v.string()),
  houseNumber: v.optional(v.string()),
  neighborhood: v.optional(v.string()),
  country: v.string(),
  region: v.optional(v.string()),
  state: v.optional(v.string()),
  zip: v.optional(v.string()),
});

export const customerDetailsSchema = v.object({
  email: v.string(),
  firstName: v.string(),
  lastName: v.string(),
  phoneNumber: v.string(),
});

export const orderDetailsSchema = v.object({
  billingDetails: v.union(
    v.object({
      ...addressSchema.fields,
      billingAddressSameAsDelivery: v.optional(v.boolean()),
    }),
    v.null()
  ),
  customerDetails: customerDetailsSchema,
  deliveryDetails: v.union(addressSchema, v.null(), v.string()),
  deliveryFee: v.union(v.number(), v.null()),
  deliveryMethod: v.string(),
  deliveryOption: v.union(v.string(), v.null()),
  deliveryInstructions: v.optional(v.string()),
  pickupLocation: v.union(v.string(), v.null()),
  discount: v.union(v.record(v.string(), v.any()), v.null()),
});

export const onlineOrderSchema = v.object({
  amount: v.number(),
  bagId: v.id("bag"),
  billingDetails: v.union(
    v.object({
      ...addressSchema.fields,
      billingAddressSameAsDelivery: v.optional(v.boolean()),
    }),
    v.null()
  ),
  checkoutSessionId: v.id("checkoutSession"),
  completedAt: v.optional(v.number()),
  customerDetails: customerDetailsSchema,
  deliveryDetails: v.union(addressSchema, v.null(), v.string()),
  deliveryInstructions: v.union(v.string(), v.null()),
  deliveryFee: v.union(v.number(), v.null()),
  deliveryMethod: v.string(),
  deliveryOption: v.union(v.string(), v.null()),
  didSendConfirmationEmail: v.optional(v.boolean()),
  didRefundDeliveryFee: v.optional(v.boolean()),
  didSendCompletedEmail: v.optional(v.boolean()),
  didSendReadyEmail: v.optional(v.boolean()),
  didSendNewOrderReceivedEmail: v.optional(v.boolean()),
  discount: v.union(v.record(v.string(), v.any()), v.null()),
  externalReference: v.optional(v.string()),
  externalTransactionId: v.optional(v.string()),
  hasVerifiedPayment: v.boolean(),
  items: v.optional(v.array(onlineOrderItemSchema)),
  orderNumber: v.string(),
  paymentMethod: v.optional(paymentMethodSchema),
  pickupLocation: v.union(v.string(), v.null()),
  readyAt: v.optional(v.number()),
  refunds: v.optional(
    v.array(v.object({ amount: v.number(), id: v.string(), date: v.number() }))
  ),
  status: v.string(),
  storeId: v.id("store"),
  storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  transitions: v.optional(
    v.array(
      v.object({
        status: v.string(),
        date: v.number(),
        signedInAthenaUser: v.optional(
          v.object({
            id: v.id("athenaUser"),
            email: v.string(),
          })
        ),
      })
    )
  ),
  updatedAt: v.optional(v.number()),
});
