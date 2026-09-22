import { v } from "convex/values";

/**
 * A revocable bearer credential a store hands to an external reader.
 *
 * Only the SHA-256 of the exact header value is stored: the raw value exists
 * once, in the mint response, and is unrecoverable afterwards. `by_tokenHash`
 * is the presentation lookup; `by_storeId_status` backs the active-token cap
 * and the store-configuration listing.
 */
export const catalogAccessTokenSchema = v.object({
  storeId: v.id("store"),
  tokenHash: v.string(),
  label: v.string(),
  status: v.union(v.literal("active"), v.literal("revoked")),
  createdAt: v.number(),
  createdByUserId: v.id("athenaUser"),
  lastUsedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
});
