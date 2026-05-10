import { v } from "convex/values";

export const managerElevationSchema = v.object({
  accountId: v.id("athenaUser"),
  createdAt: v.number(),
  endedAt: v.optional(v.number()),
  endReason: v.optional(
    v.union(
      v.literal("manager_ended"),
      v.literal("expired"),
      v.literal("superseded"),
    ),
  ),
  expiresAt: v.number(),
  managerCredentialId: v.id("staffCredential"),
  managerStaffProfileId: v.id("staffProfile"),
  organizationId: v.id("organization"),
  reason: v.optional(v.string()),
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
});
