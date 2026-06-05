import { v } from "convex/values";

const transactionCapabilityValidator = v.union(
  v.literal("products_and_services"),
  v.literal("products_only"),
  v.literal("services_only"),
);

const loginModeValidator = v.union(
  v.literal("standard"),
  v.literal("pos_only"),
);

export const posTerminalSchema = v.object({
  storeId: v.id("store"),
  fingerprintHash: v.string(),
  syncSecretHash: v.optional(v.string()),
  displayName: v.string(),
  registerNumber: v.optional(v.string()),
  transactionCapability: v.optional(transactionCapabilityValidator),
  loginMode: v.optional(loginModeValidator),
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
