import { v } from "convex/values";

export const expenseSessionSchema = v.object({
  sessionNumber: v.string(), // Human-readable session ID (e.g., "EXP-001")
  storeId: v.id("store"),
  staffProfileId: v.id("staffProfile"), // Staff profile responsible for the session
  terminalId: v.id("posTerminal"),
  registerNumber: v.optional(v.string()),
  registerSessionId: v.optional(v.id("registerSession")),

  // Session state
  status: v.string(), // "active", "held", "completed", "void", "expired"

  // Session metadata
  createdAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.number(), // Session expiration time (5 min from creation/update)
  heldAt: v.optional(v.number()),
  resumedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),

  // Notes
  notes: v.optional(v.string()), // Overall session notes/reason
});
