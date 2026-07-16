import { defineTable } from "convex/server";
import { v } from "convex/values";

export const posRecoveryExchangeStatusValidator = v.union(
  v.literal("prepared"),
  v.literal("activated"),
  v.literal("aborted"),
  v.literal("expired"),
);

export const posRecoveryExchangeSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  servicePrincipalId: v.id("servicePrincipal"),
  servicePrincipalAuthBindingId: v.id("servicePrincipalAuthBinding"),
  authUserId: v.id("users"),
  authSessionId: v.id("authSessions"),
  terminalId: v.id("posTerminal"),
  posRecoveryCredentialId: v.id("posRecoveryCredential"),
  capabilityGrantId: v.id("servicePrincipalCapability"),
  recoveryCorrelationKey: v.string(),
  consumerId: v.string(),
  capabilityId: v.string(),
  status: posRecoveryExchangeStatusValidator,
  revision: v.number(),
  principalLifecycleRevision: v.number(),
  capabilityRevision: v.number(),
  credentialRevision: v.number(),
  terminalLifecycleRevision: v.number(),
  terminalProofRevision: v.number(),
  preparedAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.number(),
  lastCorrelationId: v.string(),
  activatedAt: v.optional(v.number()),
  abortedAt: v.optional(v.number()),
  expiredAt: v.optional(v.number()),
  servicePrincipalSessionId: v.optional(v.id("servicePrincipalSession")),
  posApplicationSessionBindingId: v.optional(
    v.id("posApplicationSessionBinding"),
  ),
});

export const posRecoveryExchangeTable = defineTable(posRecoveryExchangeSchema)
  .index("by_recoveryCorrelationKey", ["recoveryCorrelationKey"])
  .index("by_authSessionId", ["authSessionId"])
  .index("by_status_and_expiresAt", ["status", "expiresAt"])
  .index("by_terminalId_and_status", ["terminalId", "status"]);
