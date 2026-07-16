import { defineTable } from "convex/server";
import { v } from "convex/values";

export const servicePrincipalStatusValidator = v.union(
  v.literal("active"),
  v.literal("disabled"),
  v.literal("revoked"),
  v.literal("decommissioned"),
);

export const servicePrincipalSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  stableKey: v.string(),
  status: servicePrincipalStatusValidator,
  lifecycleRevision: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastCorrelationId: v.string(),
  disabledAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  decommissionedAt: v.optional(v.number()),
});

export const servicePrincipalTable = defineTable(servicePrincipalSchema)
  .index("by_organizationId_and_storeId_and_stableKey", [
    "organizationId",
    "storeId",
    "stableKey",
  ])
  .index("by_organizationId_and_storeId_and_status", [
    "organizationId",
    "storeId",
    "status",
  ])
  .index("by_storeId_and_status", ["storeId", "status"]);
