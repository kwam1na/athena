import { v } from "convex/values";

const lane = v.union(
  v.literal("complete"),
  v.literal("unavailable"),
  v.literal("invalid"),
);

export const closeEvidenceLanes = v.object({
  cash: lane,
  transactions: lane,
  payments: lane,
  expenses: lane,
  inventory: lane,
});

/** Bounded normalized inputs only; never source snapshots or member identities. */
export const closeEvidenceItem = v.union(
  v.object({
    kind: v.literal("payment"),
    method: v.string(),
    amount: v.number(),
    transactionCount: v.number(),
  }),
  v.object({
    kind: v.literal("expense"),
    productSkuId: v.id("productSku"),
    productName: v.string(),
    productSku: v.string(),
    quantity: v.number(),
    spend: v.number(),
  }),
  v.object({
    kind: v.literal("inventory"),
    key: v.string(),
    productSkuId: v.union(v.id("productSku"), v.null()),
    memberCount: v.number(),
    firstCreatedAt: v.number(),
    lastCreatedAt: v.number(),
  }),
);

export const reportCloseEvidenceSchema = v.object({
  storeId: v.id("store"),
  closeId: v.id("dailyClose"),
  operatingDate: v.string(),
  closeVersion: v.optional(v.number()),
  status: v.string(),
  lifecycleStatus: v.optional(v.string()),
  completedAt: v.optional(v.number()),
  reopenedAt: v.optional(v.number()),
  supersedesCloseId: v.optional(v.id("dailyClose")),
  supersededByCloseId: v.optional(v.id("dailyClose")),
  sourceUpdatedAt: v.number(),
  sourceSignature: v.string(),
  schemaVersion: v.number(),
  expectedGeneration: v.number(),
  publishedGeneration: v.optional(v.number()),
  publishedAt: v.optional(v.number()),
  closeNetSalesMinor: v.optional(v.number()),
  closeTransactionCount: v.optional(v.number()),
  lanes: closeEvidenceLanes,
  cashVarianceMinor: v.optional(v.number()),
  transactionCount: v.optional(v.number()),
  expenseTotal: v.optional(v.number()),
  chunkCount: v.optional(v.number()),
  itemCount: v.optional(v.number()),
  digest: v.optional(v.string()),
  cleanupBlocked: v.optional(v.boolean()),
  blockedReason: v.optional(
    v.union(
      v.literal("source_missing"),
      v.literal("ownership_mismatch"),
      v.literal("source_changed"),
      v.literal("capacity_exceeded"),
      v.literal("chunk_integrity"),
    ),
  ),
});

export const reportCloseEvidenceChunkSchema = v.object({
  storeId: v.id("store"),
  headerId: v.id("reportCloseEvidence"),
  generation: v.number(),
  ordinal: v.number(),
  items: v.array(closeEvidenceItem),
});
