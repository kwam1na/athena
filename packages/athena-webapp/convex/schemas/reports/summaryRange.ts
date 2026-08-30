import { v } from "convex/values";
import { rollupContribution } from "./rollupPipeline";
export const reportRangeSummarySkuSchema = v.object({
  storeId: v.id("store"),
  rangeResultId: v.id("reportRangeResult"),
  productSkuId: v.id("productSku"),
  revenueSortKey: v.number(),
  ...rollupContribution,
});
