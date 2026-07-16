import { defineTable } from "convex/server";
import { v } from "convex/values";

export const posTerminalReconnectIntentStatusValidator = v.union(
  v.literal("pending"),
  v.literal("consumed"),
  v.literal("expired"),
  v.literal("revoked"),
);

export const posTerminalReconnectIntentSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  intentTokenHash: v.string(),
  browserFingerprintHash: v.string(),
  status: posTerminalReconnectIntentStatusValidator,
  terminalLifecycleRevision: v.number(),
  terminalProofRevision: v.number(),
  issuedAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.number(),
  lastCorrelationId: v.string(),
  consumedAt: v.optional(v.number()),
  consumedByUserId: v.optional(v.id("athenaUser")),
  expiredAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
});

export const posTerminalReconnectIntentTable = defineTable(
  posTerminalReconnectIntentSchema,
)
  .index("by_intentTokenHash", ["intentTokenHash"])
  .index("by_terminalId_and_issuedAt", ["terminalId", "issuedAt"])
  .index("by_terminalId_and_status", ["terminalId", "status"])
  .index("by_status_and_expiresAt", ["status", "expiresAt"])
  .index("by_storeId_and_status", ["storeId", "status"]);
