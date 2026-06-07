import { v } from "convex/values";

export const posPendingCheckoutItemStatusValidator = v.union(
  v.literal("pending_review"),
  v.literal("approved"),
  v.literal("linked_to_catalog"),
  v.literal("rejected"),
  v.literal("flagged"),
);

export const posPendingCheckoutItemEvidenceSchema = v.object({
  firstSeenAt: v.number(),
  lastSeenAt: v.number(),
  transactionCount: v.number(),
  totalQuantitySold: v.number(),
  observedPrices: v.array(v.number()),
  observedLookupCodes: v.array(v.string()),
  lastActorUserId: v.optional(v.id("athenaUser")),
  lastActorStaffProfileId: v.optional(v.id("staffProfile")),
  lastRegisterSessionId: v.optional(v.id("registerSession")),
  lastTerminalId: v.optional(v.id("posTerminal")),
  lastPosTransactionId: v.optional(v.id("posTransaction")),
  offlineSaleCount: v.optional(v.number()),
  localEventIds: v.optional(v.array(v.string())),
});

export const posPendingCheckoutItemSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  status: posPendingCheckoutItemStatusValidator,
  reviewPriority: v.union(
    v.literal("normal"),
    v.literal("elevated"),
    v.literal("high"),
  ),
  name: v.string(),
  normalizedName: v.string(),
  lookupCode: v.optional(v.string()),
  normalizedLookupCode: v.optional(v.string()),
  provisionalPrice: v.number(),
  currency: v.string(),
  notes: v.optional(v.string()),
  provisionalProductId: v.optional(v.id("product")),
  provisionalProductSkuId: v.optional(v.id("productSku")),
  evidence: posPendingCheckoutItemEvidenceSchema,
  approvedProductId: v.optional(v.id("product")),
  approvedProductSkuId: v.optional(v.id("productSku")),
  reviewedByUserId: v.optional(v.id("athenaUser")),
  reviewedAt: v.optional(v.number()),
  reviewNote: v.optional(v.string()),
  operationalWorkItemId: v.optional(v.id("operationalWorkItem")),
  createdByUserId: v.optional(v.id("athenaUser")),
  createdByStaffProfileId: v.optional(v.id("staffProfile")),
  createdFrom: v.union(v.literal("online"), v.literal("offline_sync")),
  createdAt: v.number(),
  updatedAt: v.number(),
});
