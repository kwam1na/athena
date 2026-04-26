import { v } from "convex/values";

export const posTransactionSchema = v.object({
  transactionNumber: v.string(),
  workflowTraceId: v.optional(v.string()),
  storeId: v.id("store"),
  sessionId: v.optional(v.id("posSession")), // Link to the session that created this transaction (if created from session)
  registerSessionId: v.optional(v.id("registerSession")),
  staffProfileId: v.optional(v.id("staffProfile")), // Staff member who processed the transaction
  registerNumber: v.optional(v.string()),
  terminalId: v.optional(v.id("posTerminal")),
  subtotal: v.number(),
  tax: v.number(),
  total: v.number(),
  customerProfileId: v.optional(v.id("customerProfile")),
  // Multi-payment support
  payments: v.array(
    v.object({
      method: v.string(), // "cash", "card", "mobile_money"
      amount: v.number(),
      timestamp: v.number(),
    })
  ),
  totalPaid: v.number(), // Sum of all payment amounts
  changeGiven: v.optional(v.number()), // Change given to customer (only for cash overpayment)
  // Backward compatibility - store primary payment method
  paymentMethod: v.optional(v.string()), // "cash", "card", "mobile_money" - primary method for backward compatibility
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
