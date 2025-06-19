import { v } from "convex/values";

export const posCustomerSchema = v.object({
  storeId: v.id("store"),

  // Basic customer info (always present)
  name: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),

  // Optional links to existing storefront accounts
  linkedStoreFrontUserId: v.optional(v.id("storeFrontUser")),
  linkedGuestId: v.optional(v.id("guest")),

  // POS-specific data
  address: v.optional(
    v.object({
      street: v.optional(v.string()),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      zipCode: v.optional(v.string()),
      country: v.optional(v.string()),
    })
  ),

  // POS-specific metrics
  notes: v.optional(v.string()),
  totalSpent: v.optional(v.number()),
  transactionCount: v.optional(v.number()),
  lastTransactionAt: v.optional(v.number()),
  firstTransactionAt: v.optional(v.number()),

  // Loyalty & preferences (POS-specific)
  loyaltyPoints: v.optional(v.number()),
  loyaltyTier: v.optional(v.string()), // "bronze", "silver", "gold", etc.
  preferredPaymentMethod: v.optional(v.string()),
  tags: v.optional(v.array(v.string())), // "vip", "frequent", "new", etc.

  // Customer preferences
  marketingOptIn: v.optional(v.boolean()),
  receiptPreference: v.optional(v.string()), // "email", "sms", "print", "none"

  // Status
  isActive: v.optional(v.boolean()),
  createdBy: v.optional(v.id("athenaUser")), // Staff member who created the customer
});
