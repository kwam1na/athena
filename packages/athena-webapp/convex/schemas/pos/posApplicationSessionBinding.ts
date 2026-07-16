import { defineTable } from "convex/server";
import { v } from "convex/values";

export const posApplicationSessionBindingStatusValidator = v.union(
  v.literal("active"),
  v.literal("revoked"),
  v.literal("superseded"),
);

export const posApplicationSessionBindingSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  servicePrincipalId: v.id("servicePrincipal"),
  servicePrincipalSessionId: v.id("servicePrincipalSession"),
  terminalId: v.id("posTerminal"),
  posRecoveryCredentialId: v.id("posRecoveryCredential"),
  capabilityGrantId: v.id("servicePrincipalCapability"),
  consumerId: v.string(),
  capabilityId: v.string(),
  status: posApplicationSessionBindingStatusValidator,
  revision: v.number(),
  principalLifecycleRevision: v.number(),
  capabilityRevision: v.number(),
  credentialRevision: v.number(),
  terminalLifecycleRevision: v.number(),
  terminalProofRevision: v.number(),
  offlineAuthorityReceipt: v.optional(v.string()),
  activatedAt: v.number(),
  updatedAt: v.number(),
  lastCorrelationId: v.string(),
  revokedAt: v.optional(v.number()),
  supersededAt: v.optional(v.number()),
});

export const posApplicationSessionBindingTable = defineTable(
  posApplicationSessionBindingSchema,
)
  .index("by_servicePrincipalSessionId", ["servicePrincipalSessionId"])
  .index(
    "by_servicePrincipalId_and_terminalId_and_consumerId_and_status",
    ["servicePrincipalId", "terminalId", "consumerId", "status"],
  )
  .index("by_terminalId_and_status", ["terminalId", "status"])
  .index("by_storeId_and_status", ["storeId", "status"]);
