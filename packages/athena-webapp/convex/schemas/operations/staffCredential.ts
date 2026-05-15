import { v } from "convex/values";

export const staffCredentialSchema = v.object({
  staffProfileId: v.id("staffProfile"),
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  username: v.string(),
  pinHash: v.optional(v.string()),
  localPinVerifier: v.optional(
    v.object({
      algorithm: v.string(),
      hash: v.string(),
      iterations: v.number(),
      salt: v.string(),
      version: v.number(),
    }),
  ),
  localVerifierVersion: v.optional(v.number()),
  status: v.union(
    v.literal("pending"),
    v.literal("active"),
    v.literal("suspended"),
    v.literal("revoked")
  ),
  failedAuthenticationAttempts: v.optional(v.number()),
  authenticationLockedUntil: v.optional(v.number()),
  lastAuthenticatedAt: v.optional(v.number()),
});
