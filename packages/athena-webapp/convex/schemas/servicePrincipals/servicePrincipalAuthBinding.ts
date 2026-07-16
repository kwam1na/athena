import { defineTable } from "convex/server";
import { v } from "convex/values";

export const servicePrincipalAuthBindingStatusValidator = v.union(
  v.literal("active"),
  v.literal("decommissioned"),
);

export const servicePrincipalAuthBindingSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  servicePrincipalId: v.id("servicePrincipal"),
  authUserId: v.id("users"),
  status: servicePrincipalAuthBindingStatusValidator,
  revision: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastCorrelationId: v.string(),
  decommissionedAt: v.optional(v.number()),
});

export const servicePrincipalAuthBindingTable = defineTable(
  servicePrincipalAuthBindingSchema,
)
  .index("by_authUserId", ["authUserId"])
  .index("by_servicePrincipalId", ["servicePrincipalId"])
  .index("by_organizationId_and_storeId_and_status", [
    "organizationId",
    "storeId",
    "status",
  ]);
