import { v } from "convex/values";

export const posTerminalSchema = v.object({
  storeId: v.id("store"),
  fingerprintHash: v.string(),
  displayName: v.string(),
  registeredByUserId: v.id("athenaUser"),
  browserInfo: v.object({
    userAgent: v.string(),
    platform: v.optional(v.string()),
    language: v.optional(v.string()),
    vendor: v.optional(v.string()),
    screenResolution: v.optional(v.string()),
    colorDepth: v.optional(v.number()),
  }),
  registeredAt: v.number(),
  status: v.union(v.literal("active"), v.literal("revoked"), v.literal("lost")),
});
