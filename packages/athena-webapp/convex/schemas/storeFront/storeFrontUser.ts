import { v } from "convex/values";

const addressSchema = v.object({
  address: v.string(),
  city: v.string(),
  state: v.optional(v.string()),
  zip: v.optional(v.string()),
  country: v.string(),
  region: v.optional(v.string()),
});

export const storeFrontUserSchema = v.object({
  email: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  phoneNumber: v.optional(v.string()),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  billingAddress: v.optional(addressSchema),
  shippingAddress: v.optional(addressSchema),
});
