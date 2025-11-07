import { v } from "convex/values";

export const posSessionSchema = v.object({
  sessionNumber: v.string(), // Human-readable session ID (e.g., "SES-001")
  storeId: v.id("store"),
  cashierId: v.optional(v.id("athenaUser")), // Staff member who created the session
  registerNumber: v.optional(v.string()),

  // Session state
  status: v.string(), // "active", "held", "completed", "void"
  transactionId: v.optional(v.id("posTransaction")), // Link to transaction created from this session
  terminalId: v.id("posTerminal"),

  // Cart contents - now stored in separate posSessionItem table
  // Kept here for backward compatibility queries only

  // Customer information
  customerId: v.optional(v.id("posCustomer")),
  customerInfo: v.optional(
    v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
    })
  ),

  // Session metadata
  createdAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.number(), // Session expiration time (20 min from creation/update)
  heldAt: v.optional(v.number()),
  resumedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),

  // Totals (calculated and stored for quick reference)
  subtotal: v.optional(v.number()),
  tax: v.optional(v.number()),
  total: v.optional(v.number()),

  // Notes
  holdReason: v.optional(v.string()),
  notes: v.optional(v.string()),
});
