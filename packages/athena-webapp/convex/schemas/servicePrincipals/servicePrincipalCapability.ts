import { defineTable } from "convex/server";
import { v } from "convex/values";

export const servicePrincipalCapabilityStatusValidator = v.union(
  v.literal("active"),
  v.literal("revoked"),
);

export const servicePrincipalCapabilitySchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  servicePrincipalId: v.id("servicePrincipal"),
  consumerId: v.string(),
  capabilityId: v.string(),
  status: servicePrincipalCapabilityStatusValidator,
  revision: v.number(),
  grantedAt: v.number(),
  updatedAt: v.number(),
  lastCorrelationId: v.string(),
  expiresAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
});

export const servicePrincipalCapabilityTable = defineTable(
  servicePrincipalCapabilitySchema,
)
  .index("by_servicePrincipalId_and_consumerId_and_capabilityId", [
    "servicePrincipalId",
    "consumerId",
    "capabilityId",
  ])
  .index("by_servicePrincipalId_and_status", [
    "servicePrincipalId",
    "status",
  ])
  .index("by_organizationId_and_storeId_and_status", [
    "organizationId",
    "storeId",
    "status",
  ]);
