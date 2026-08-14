import { v } from "convex/values";

export const waiverCandidateSchema = v.object({
  repository: v.string(),
  prNumber: v.number(),
  headSha: v.string(),
  baseRef: v.string(),
  baseSha: v.string(),
  diffBaseSha: v.string(),
  deliverableTreeSha: v.string(),
  identityVersion: v.string(),
  waivedFindingCodes: v.array(v.string()),
  reason: v.string(),
});

export const harnessWaiverPasskeySchema = v.object({
  credentialId: v.string(),
  publicKey: v.bytes(),
  counter: v.number(),
  transports: v.array(v.string()),
  deviceType: v.string(),
  backedUp: v.boolean(),
  reviewerEmail: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const harnessWaiverRegistrationSchema = v.object({
  challenge: v.string(),
  reviewerEmail: v.string(),
  expiresAt: v.number(),
  consumedAt: v.optional(v.number()),
});

export const harnessWaiverApprovalSchema = v.object({
  publicTokenHash: v.string(),
  challenge: v.string(),
  candidate: waiverCandidateSchema,
  status: v.union(v.literal("pending"), v.literal("approved"), v.literal("consumed")),
  expiresAt: v.number(),
  credentialId: v.optional(v.string()),
  approvedAt: v.optional(v.number()),
  consumeExpiresAt: v.optional(v.number()),
  consumedAt: v.optional(v.number()),
  createdAt: v.number(),
});
