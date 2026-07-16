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
  organizationId: v.optional(v.id("organization")),
  storeId: v.id("store"),
  fingerprintHash: v.string(),
  syncSecretHash: v.optional(v.string()),
  displayName: v.string(),
  heartbeatEnabled: v.optional(v.boolean()),
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
  lifecycleRevision: v.optional(v.number()),
  proofRevision: v.optional(v.number()),
  disconnectedAt: v.optional(v.number()),
  disconnectedByUserId: v.optional(v.id("athenaUser")),
  reactivatedAt: v.optional(v.number()),
  reactivatedByUserId: v.optional(v.id("athenaUser")),
  proofRotatedAt: v.optional(v.number()),
  lastServicePrincipalRecoveryAt: v.optional(v.number()),
  servicePrincipalRecoveryVersion: v.optional(v.number()),
  lastCorrelationId: v.optional(v.string()),
  status: v.union(v.literal("active"), v.literal("revoked"), v.literal("lost")),
});
