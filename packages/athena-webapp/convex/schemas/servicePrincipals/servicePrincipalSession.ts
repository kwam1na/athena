import { defineTable } from "convex/server";
import { v } from "convex/values";

export const servicePrincipalSessionStatusValidator = v.union(
  v.literal("active"),
  v.literal("revoked"),
  v.literal("superseded"),
);

export const servicePrincipalSessionSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  servicePrincipalId: v.id("servicePrincipal"),
  servicePrincipalAuthBindingId: v.id("servicePrincipalAuthBinding"),
  authUserId: v.id("users"),
  authSessionId: v.id("authSessions"),
  consumerId: v.string(),
  requiredCapabilityId: v.string(),
  principalLifecycleRevision: v.number(),
  capabilityRevision: v.number(),
  status: servicePrincipalSessionStatusValidator,
  revision: v.number(),
  issuedAt: v.number(),
  lastSeenAt: v.number(),
  idleExpiresAt: v.number(),
  absoluteExpiresAt: v.number(),
  updatedAt: v.number(),
  lastCorrelationId: v.string(),
  revokedAt: v.optional(v.number()),
  supersededAt: v.optional(v.number()),
});

export const servicePrincipalSessionTable = defineTable(
  servicePrincipalSessionSchema,
)
  .index("by_authSessionId", ["authSessionId"])
  .index("by_servicePrincipalAuthBindingId_and_status", [
    "servicePrincipalAuthBindingId",
    "status",
  ])
  .index("by_servicePrincipalId_and_consumerId_and_status", [
    "servicePrincipalId",
    "consumerId",
    "status",
  ])
  .index("by_status_and_absoluteExpiresAt", ["status", "absoluteExpiresAt"]);
