import { v } from "convex/values";

export const posTransactionSchema = v.object({
  transactionNumber: v.string(),
  storeId: v.id("store"),
  customerId: v.optional(v.id("posCustomer")), // Link to POS customer
  cashierId: v.optional(v.id("athenaUser")), // Staff member who processed the transaction
  registerNumber: v.optional(v.string()),
  subtotal: v.number(),
  tax: v.number(),
  total: v.number(),
  paymentMethod: v.string(), // "cash", "card", "digital_wallet"
  amountPaid: v.optional(v.number()), // Amount customer paid
  changeGiven: v.optional(v.number()), // Change given to customer
  status: v.string(), // "completed", "void", "refunded"
  completedAt: v.number(),
  customerInfo: v.optional(
    v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
    })
  ),
  notes: v.optional(v.string()),
  refundReason: v.optional(v.string()),
  refundedAt: v.optional(v.number()),
  voidedAt: v.optional(v.number()),
  receiptPrinted: v.optional(v.boolean()),
});
