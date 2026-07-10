import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import { upsertProjectionHealthWithCtx } from "../health";
import { completedProjectionWorkPatch } from "../projectionWork";
import { scheduleActiveSkuInsightRefreshWithCtx } from "./skuInsights";

export function currentInventoryMetricRows(input: {
  knownCostPoolMinor: number;
  onHandQuantity: number;
  sellableQuantity: number;
  uncostedQuantity: number;
}) {
  return [
    {
      metric: "on_hand_units" as const,
      unknownQuantity: 0,
      value: input.onHandQuantity,
    },
    {
      metric: "sellable_units" as const,
      unknownQuantity: 0,
      value: input.sellableQuantity,
    },
    {
      metric: "inventory_value" as const,
      unknownQuantity: input.uncostedQuantity,
      value: input.knownCostPoolMinor,
    },
  ];
}

export async function projectInventoryPositionWithCtx(
  ctx: MutationCtx,
  input: {
    asOf: number;
    completeness: Doc<"reportingCurrentValuationProjection">["completeness"];
    generation: Doc<"reportingProjectionGeneration">;
    position: Doc<"reportingInventoryPosition">;
    sourceWatermark: number;
  },
) {
  const now = Date.now();
  for (const metric of currentInventoryMetricRows(input.position)) {
    const row = await ctx.db
      .query("reportingCurrentValuationProjection")
      .withIndex("by_generationId_productSkuId_metric", (q) =>
        q
          .eq("generationId", input.generation._id)
          .eq("productSkuId", input.position.productSkuId)
          .eq("metric", metric.metric),
      )
      .first();
    const value: Omit<
      Doc<"reportingCurrentValuationProjection">,
      "_creationTime" | "_id"
    > = {
      asOf: input.asOf,
      completeness: input.completeness,
      currencyCode:
        metric.metric === "inventory_value"
          ? input.position.currencyCode
          : undefined,
      currencyMinorUnitScale:
        metric.metric === "inventory_value"
          ? input.position.currencyMinorUnitScale
          : undefined,
      generationId: input.generation._id,
      knownValue: metric.value,
      limitingReason:
        input.position.valuationStatus === "rebuild_required"
          ? ("reconciliation_drift" as const)
          : undefined,
      metric: metric.metric,
      metricContractVersion: input.generation.metricContractVersion,
      organizationId: input.position.organizationId,
      productSkuId: input.position.productSkuId,
      projectedAt: now,
      sourceWatermark: Math.max(
        input.generation.sourceWatermark,
        input.sourceWatermark,
      ),
      storeId: input.position.storeId,
      unknownQuantity: metric.unknownQuantity,
    };
    if (row) {
      await ctx.db.patch("reportingCurrentValuationProjection", row._id, value);
    } else {
      await ctx.db.insert("reportingCurrentValuationProjection", value);
    }
  }
}

export const processInventoryEffect = internalMutation({
  args: { effectId: v.id("reportingInventoryEffect") },
  handler: async (ctx, args) => {
    const effect = await ctx.db.get("reportingInventoryEffect", args.effectId);
    if (!effect) return;
    if (!effect.positionId) {
      await ctx.db.patch(
        "reportingInventoryEffect",
        effect._id,
        completedProjectionWorkPatch(effect, Date.now()),
      );
      return;
    }
    const position = await ctx.db.get(
      "reportingInventoryPosition",
      effect.positionId,
    );
    if (!position || position.storeId !== effect.storeId) {
      throw new Error("Inventory effect projection position is invalid");
    }
    const activation = await ctx.db
      .query("reportingProjectionActivation")
      .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
        q
          .eq("storeId", effect.storeId)
          .eq("projectionKind", "current_inventory"),
      )
      .order("desc")
      .first();
    if (!activation) {
      await ctx.db.patch(
        "reportingInventoryEffect",
        effect._id,
        completedProjectionWorkPatch(effect, Date.now()),
      );
      return;
    }
    const generation = await ctx.db.get(
      "reportingProjectionGeneration",
      activation.generationId,
    );
    if (!generation || generation.storeId !== effect.storeId) {
      throw new Error("Inventory effect projection generation is invalid");
    }
    const now = Date.now();
    await projectInventoryPositionWithCtx(ctx, {
      asOf: Math.max(effect.occurrenceAt, position.lastEffectAt),
      completeness: effect.completeness,
      generation,
      position,
      sourceWatermark: effect._creationTime,
    });
    if (effect.operatingDate) {
      await scheduleActiveSkuInsightRefreshWithCtx(ctx, {
        operatingDate: effect.operatingDate,
        productSkuId: effect.productSkuId,
        storeId: effect.storeId,
      });
    }
    for (const metric of currentInventoryMetricRows(position)) {
      const evidence = await ctx.db
        .query("reportingProjectionEvidence")
        .withIndex("by_generationId_inventoryEffectId_metric", (q) =>
          q
            .eq("generationId", generation._id)
            .eq("inventoryEffectId", effect._id)
            .eq("metric", metric.metric),
        )
        .first();
      if (evidence) continue;
      await ctx.db.insert("reportingProjectionEvidence", {
        businessEventKey: effect.businessEventKey,
        completeness: effect.completeness,
        createdAt: now,
        effectType: effect.effectType,
        generationId: generation._id,
        inventoryEffectId: effect._id,
        metric: metric.metric,
        occurrenceAt: effect.occurrenceAt,
        operatingDate: effect.operatingDate,
        organizationId: effect.organizationId,
        productSkuId: effect.productSkuId,
        quantity: effect.physicalQuantityDelta,
        returnedQuantity: effect.returnedQuantity,
        returnDisposition: effect.returnDisposition,
        recognitionAt: effect.occurrenceAt,
        sourceDomain: effect.sourceDomain,
        sourceWatermark: effect._creationTime,
        storeId: effect.storeId,
      });
    }
    if (generation.sourceWatermark < effect._creationTime) {
      await ctx.db.patch("reportingProjectionGeneration", generation._id, {
        sourceWatermark: effect._creationTime,
      });
    }
    await upsertProjectionHealthWithCtx(ctx, {
      activeGenerationId: generation._id,
      factContractVersion: generation.factContractVersion,
      freshnessLagMs: Math.max(0, now - effect.occurrenceAt),
      metricContractVersion: generation.metricContractVersion,
      organizationId: generation.organizationId,
      processingWatermark: Math.max(
        generation.sourceWatermark,
        effect._creationTime,
      ),
      projectionContractVersion: generation.projectionContractVersion,
      projectionKind: "current_inventory",
      quarantinedCount: effect.valuationStatus === "rebuild_required" ? 1 : 0,
      sourceDomain: effect.sourceDomain,
      storeId: generation.storeId,
      updatedAt: now,
    });
    await ctx.db.patch(
      "reportingInventoryEffect",
      effect._id,
      completedProjectionWorkPatch(effect, Date.now()),
    );
  },
});
