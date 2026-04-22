import { v } from "convex/values";

export const staffCredentialSchema = v.object({
  staffProfileId: v.id("staffProfile"),
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  username: v.string(),
  pinHash: v.optional(v.string()),
  status: v.union(
    v.literal("pending"),
    v.literal("active"),
    v.literal("suspended"),
    v.literal("revoked")
  ),
  lastAuthenticatedAt: v.optional(v.number()),
});
