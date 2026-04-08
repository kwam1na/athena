import { v } from "convex/values";

export const mtnCollectionsTokenSchema = v.object({
  storeId: v.id("store"),
  accessToken: v.string(),
  expiresAt: v.number(),
  updatedAt: v.number(),
});

export const mtnCollectionTransactionSchema = v.object({
  storeId: v.id("store"),
  providerReference: v.string(),
  externalId: v.optional(v.string()),
  externalTransactionId: v.optional(v.string()),
  status: v.string(),
  amount: v.number(),
  currency: v.optional(v.string()),
  requestedAt: v.number(),
  completedAt: v.optional(v.number()),
  payerPartyIdType: v.optional(v.string()),
  payerIdentifierMasked: v.optional(v.string()),
  payerMessage: v.optional(v.string()),
  payeeNote: v.optional(v.string()),
  providerPayload: v.optional(v.record(v.string(), v.any())),
  callbackMetadata: v.optional(v.record(v.string(), v.any())),
  callbackCount: v.optional(v.number()),
  updatedAt: v.number(),
});
