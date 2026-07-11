export function buildDailyCloseTrustSummary(input: {
  acceptedCloseVersion: number;
  completeness: Doc<"reportingDailyCloseProjection">["completeness"];
  operatingDate: string;
  postCloseDeficitAdjustmentDeltaMinor: number;
  postCloseNetSalesDeltaMinor: number;
  postCloseRefundsDeltaMinor: number;
}) {
  return {
    ...input,
    hasPostCloseActivity: Boolean(
      input.postCloseDeficitAdjustmentDeltaMinor ||
        input.postCloseNetSalesDeltaMinor ||
        input.postCloseRefundsDeltaMinor,
    ),
  };
}

export async function materializeDailyCloseTrustWithCtx(
  ctx: MutationCtx,
  input: {
    close: Doc<"reportingDailyCloseProjection">;
    generation: Doc<"reportingProjectionGeneration">;
    periodKey: string;
    sourceGenerationIds: Doc<"reportingProjectionGeneration">["_id"][];
  },
) {
  const summary = buildDailyCloseTrustSummary(input.close);
  const existing = await ctx.db
    .query("reportingDailyCloseTrust")
    .withIndex("by_generationId_operatingDate", (q) =>
      q.eq("generationId", input.generation._id).eq("operatingDate", input.close.operatingDate),
    )
    .first();
  const value: Omit<Doc<"reportingDailyCloseTrust">, "_creationTime" | "_id"> = {
    acceptedCloseProjectionId: input.close._id,
    ...summary,
    generationId: input.generation._id,
    limitingReason: input.close.limitingReason,
    organizationId: input.close.organizationId,
    periodKey: input.periodKey,
    projectedAt: input.close.projectedAt,
    rangeEndDate: input.close.operatingDate,
    rangeStartDate: input.close.operatingDate,
    sourceGenerationIds: input.sourceGenerationIds,
    sourceWatermark: input.close.sourceWatermark,
    storeId: input.close.storeId,
  };
  if (existing) await ctx.db.replace(existing._id, value);
  else await ctx.db.insert("reportingDailyCloseTrust", value);
}
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
