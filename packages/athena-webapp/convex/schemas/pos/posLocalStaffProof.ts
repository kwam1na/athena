import { v } from "convex/values";

export const posLocalStaffProofSchema = v.object({
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  staffProfileId: v.id("staffProfile"),
  credentialId: v.id("staffCredential"),
  credentialVersion: v.optional(v.number()),
  tokenHash: v.string(),
  status: v.union(v.literal("active"), v.literal("revoked")),
  createdAt: v.number(),
  expiresAt: v.number(),
  lastUsedAt: v.optional(v.number()),
});
