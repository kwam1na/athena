import { v } from "convex/values";

export const expenseTransactionSchema = v.object({
  transactionNumber: v.string(), // Human-readable transaction ID (e.g., "001")
  storeId: v.id("store"),
  sessionId: v.id("expenseSession"), // Link to the session that created this transaction
  staffProfileId: v.id("staffProfile"), // Staff profile who processed the transaction
  registerNumber: v.optional(v.string()),

  // Transaction totals
  totalValue: v.number(), // Sum of item costs

  // Transaction state
  status: v.string(), // "completed", "void"
  completedAt: v.number(),

  // Notes
  notes: v.optional(v.string()),
  voidedAt: v.optional(v.number()),
});
