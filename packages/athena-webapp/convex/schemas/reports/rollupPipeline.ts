import { v } from "convex/values";

export const rollupContribution = {
  unitsSold: v.number(),
  unitsReturned: v.number(),
  grossSalesMinor: v.number(),
  netSalesMinor: v.number(),
  refundsMinor: v.number(),
  uncostedRevenueMinor: v.number(),
  grossProfitMinor: v.union(v.number(), v.null()),
};
export const reportRollupInputSchema = v.object({
  storeId: v.id("store"),
  operatingDate: v.string(),
  revision: v.number(),
  rowCount: v.number(),
  chunkCount: v.number(),
  digest: v.string(),
  createdAt: v.number(),
});
export const reportRollupInputChunkSchema = v.object({
  storeId: v.id("store"),
  inputId: v.id("reportRollupInput"),
  ordinal: v.number(),
  rows: v.array(
    v.object({ productSkuId: v.id("productSku"), ...rollupContribution }),
  ),
});
export const reportRollupInputCurrentSchema = v.object({
  storeId: v.id("store"),
  operatingDate: v.string(),
  inputId: v.id("reportRollupInput"),
  revision: v.number(),
});
export const reportRollupEpochSchema = v.object({
  storeId: v.id("store"),
  epoch: v.string(),
  createdAt: v.number(),
  backfillCursor: v.union(v.string(), v.null()),
  backfillComplete: v.boolean(),
});
export const reportRollupCheckpointSchema = v.object({
  storeId: v.id("store"),
  epoch: v.string(),
  operatingDate: v.string(),
  productSkuId: v.id("productSku"),
  revision: v.number(),
  ...rollupContribution,
});
export const reportRollupDayStateSchema = v.object({
  storeId: v.id("store"),
  epoch: v.string(),
  operatingDate: v.string(),
  inputId: v.id("reportRollupInput"),
  revision: v.number(),
  phase: v.union(v.literal("apply"), v.literal("delete"), v.literal("done")),
  nextChunk: v.number(),
  deleteCursor: v.union(v.string(), v.null()),
  updatedAt: v.number(),
});
export const reportPeriodReadinessSchema = v.object({
  storeId: v.id("store"),
  epoch: v.string(),
  periodKey: v.string(),
  status: v.union(
    v.literal("ready"),
    v.literal("pending"),
    v.literal("blocked"),
  ),
  pendingDays: v.number(),
  publicationRevision: v.number(),
  updatedAt: v.number(),
});
export const reportPeriodObligationSchema = v.object({
  storeId: v.id("store"),
  epoch: v.string(),
  periodKey: v.string(),
  operatingDate: v.string(),
  revision: v.number(),
});
export const reportEpochSkuRollupSchema = v.object({
  storeId: v.id("store"),
  epoch: v.string(),
  periodKey: v.string(),
  productSkuId: v.id("productSku"),
  ...rollupContribution,
  knownProfitMinor: v.number(),
  unknownProfitDays: v.number(),
  contributingDays: v.number(),
  revenueSortKey: v.number(),
  unitsSortKey: v.number(),
});
