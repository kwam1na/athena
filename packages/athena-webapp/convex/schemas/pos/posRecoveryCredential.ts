import { v } from "convex/values";

export const posRecoveryCredentialSchema = v.object({
  codeHash: v.string(),
  codeSalt: v.string(),
  codeVersion: v.number(),
  createdAt: v.number(),
  createdByUserId: v.optional(v.id("athenaUser")),
  failedAttemptCount: v.number(),
  failureAuditBucket: v.optional(v.number()),
  lastFailedAt: v.optional(v.number()),
  lastUsedAt: v.optional(v.number()),
  lockedAt: v.optional(v.number()),
  lockedUntil: v.optional(v.number()),
  organizationId: v.id("organization"),
  plaintextCode: v.optional(v.string()),
  posAccountId: v.id("athenaUser"),
  revokedAt: v.optional(v.number()),
  revokedByUserId: v.optional(v.id("athenaUser")),
  rotatedAt: v.number(),
  rotatedByUserId: v.optional(v.id("athenaUser")),
  status: v.union(v.literal("active"), v.literal("locked"), v.literal("revoked")),
  storeId: v.id("store"),
});
