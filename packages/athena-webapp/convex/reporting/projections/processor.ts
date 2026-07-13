import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import { deriveFactMetricContributions } from "./factContributions";
import { applyDailyCloseFactWithCtx } from "./dailyClose";
import { scheduleActiveSkuInsightRefreshWithCtx } from "./skuInsights";
import { upsertProjectionHealthWithCtx } from "../health";
import { completedProjectionWorkPatch } from "../projectionWork";
import {
  metricsForProjectionKind,
  updateMetricCoverageForFactWithCtx,
} from "../coverage";
import { reportingPeriodLineage } from "../factFingerprint";
import type { ReportingMetricName } from "../../../shared/reportingContract";

type ProjectionKind = "store_day" | "sku_day";

function lineageFields(fact: Doc<"reportingFact">) {
  reportingPeriodLineage(fact);
  return {
    timezoneVersionId: fact.timezoneVersionId,
    timezoneVersionHash: fact.timezoneVersionHash,
    scheduleVersionId: fact.scheduleVersionId,
    historicalInterpretationPolicyId: fact.historicalInterpretationPolicyId,
    historicalInterpretationPolicyHash: fact.historicalInterpretationPolicyHash,
  };
}

function sameLineage(
  row: Pick<Doc<"reportingStoreDayProjection">, "timezoneVersionId" | "timezoneVersionHash">,
  fact: Doc<"reportingFact">,
) {
  return (
    row.timezoneVersionId === fact.timezoneVersionId &&
    row.timezoneVersionHash === fact.timezoneVersionHash
  );
}

const QUANTITY_METRICS = new Set([
  "units_sold",
  "units_returned",
  "purchase_commitment_units",
  "inventory_consumed_units",
]);

const VALUATION_METRICS = new Set(["known_cogs", "inventory_consumed_value"]);

export type FactContributionProjectionDisposition =
  | "project"
  | "unsupported_metric"
  | "missing_sku"
  | "missing_currency";

export function currencyForFactMetric(
  fact: Pick<
    Doc<"reportingFact">,
    | "currencyCode"
    | "inventoryContributionKind"
    | "revenueCurrencyCode"
    | "valuationCurrencyCode"
  >,
  metric: string,
) {
  if (QUANTITY_METRICS.has(metric)) return undefined;
  if (VALUATION_METRICS.has(metric)) return fact.valuationCurrencyCode;
  if (metric === "gross_profit") {
    return fact.inventoryContributionKind
      ? fact.valuationCurrencyCode
      : (fact.revenueCurrencyCode ?? fact.currencyCode);
  }
  return fact.revenueCurrencyCode ?? fact.currencyCode;
}

export function minorUnitScaleForFactMetric(
  fact: Doc<"reportingFact">,
  metric: string,
) {
  if (QUANTITY_METRICS.has(metric)) return undefined;
  if (VALUATION_METRICS.has(metric) || fact.inventoryContributionKind) {
    return fact.valuationCurrencyMinorUnitScale;
  }
  return fact.revenueCurrencyMinorUnitScale ?? fact.currencyMinorUnitScale;
}

export function attributedProjectionProductSkuId(
  fact: Pick<Doc<"reportingFact">, "canonicalProductSkuId" | "productSkuId">,
) {
  return fact.canonicalProductSkuId ?? fact.productSkuId;
}

export function factContributionProjectionEligibility(input: {
  fact: Doc<"reportingFact">;
  metric: ReportingMetricName;
  projectionKind: Doc<"reportingProjectionGeneration">["projectionKind"];
}): FactContributionProjectionDisposition {
  if (!metricsForProjectionKind(input.projectionKind).includes(input.metric)) {
    return "unsupported_metric";
  }
  if (
    input.projectionKind === "sku_day" &&
    !attributedProjectionProductSkuId(input.fact)
  ) {
    return "missing_sku";
  }
  if (QUANTITY_METRICS.has(input.metric)) return "project";
  if (
    currencyForFactMetric(input.fact, input.metric) === undefined ||
    minorUnitScaleForFactMetric(input.fact, input.metric) === undefined
  ) {
    return "missing_currency";
  }
  return "project";
}

export function mergeProjectionValue(input: {
  currentCurrencyCode?: string;
  currentKnownValue?: number;
  currentLimitingReason?: string;
  incomingCurrencyCode?: string;
  incomingValue: number;
}) {
  const currenciesConflict =
    input.currentLimitingReason === "mixed_currency" ||
    (input.currentKnownValue !== undefined &&
      input.currentCurrencyCode !== input.incomingCurrencyCode);
  if (currenciesConflict) {
    return {
      completeness: "unavailable" as const,
      knownValue: undefined,
      limitingReason: "mixed_currency" as const,
    };
  }
  return {
    knownValue: (input.currentKnownValue ?? 0) + input.incomingValue,
  };
}

async function activeGeneration(
  ctx: MutationCtx,
  storeId: Id<"store">,
  projectionKind: ProjectionKind,
) {
  const activation = await ctx.db
    .query("reportingProjectionActivation")
    .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
      q.eq("storeId", storeId).eq("projectionKind", projectionKind),
    )
    .order("desc")
    .first();
  if (!activation) return null;
  const generation = await ctx.db.get(
    "reportingProjectionGeneration",
    activation.generationId,
  );
  return generation?.storeId === storeId ? generation : null;
}

async function alreadyProjected(
  ctx: MutationCtx,
  generationId: Id<"reportingProjectionGeneration">,
  factId: Id<"reportingFact">,
  metric: string,
) {
  const rows = await ctx.db
    .query("reportingProjectionEvidence")
    .withIndex("by_generationId_factId_metric", (q) =>
      q
        .eq("generationId", generationId)
        .eq("factId", factId)
        .eq("metric", metric),
    )
    .take(2);
  if (rows.length > 1) {
    throw new Error("Projection evidence identity is duplicated");
  }
  return rows[0] ?? null;
}

async function insertEvidence(
  ctx: MutationCtx,
  generationId: Id<"reportingProjectionGeneration">,
  fact: Doc<"reportingFact">,
  metric: string,
  now: number,
  disposition: "projected" | "omitted_missing_currency" = "projected",
) {
  await ctx.db.insert("reportingProjectionEvidence", {
    amountMinor: fact.amountMinor,
    businessEventKey: fact.businessEventKey,
    completeness: fact.completeness,
    createdAt: now,
    disposition,
    currencyCode: fact.currencyCode,
    revenueCurrencyCode: fact.revenueCurrencyCode ?? fact.currencyCode,
    valuationCurrencyCode: fact.valuationCurrencyCode,
    factId: fact._id,
    inventoryEffectId: fact.inventoryEffectId,
    factType: fact.factType,
    generationId,
    limitingReason: fact.limitingReason,
    metric,
    occurrenceAt: fact.occurrenceAt,
    operatingDate: fact.operatingDate,
    ...lineageFields(fact),
    organizationId: fact.organizationId,
    productSkuId: attributedProjectionProductSkuId(fact),
    recognitionProductSkuId: fact.recognitionProductSkuId ?? fact.productSkuId,
    originalProductSkuId: fact.originalProductSkuId,
    provisionalProductSkuId: fact.provisionalProductSkuId,
    attributionKind: fact.attributionKind,
    attributionVersion: fact.attributionVersion,
    channel: fact.channel,
    quantity: fact.quantity,
    originalQuantity: fact.originalQuantity,
    unitPriceMinor: fact.unitPriceMinor,
    allocatedDiscountMinor: fact.allocatedDiscountMinor,
    recognizedNetAmountMinor: fact.recognizedNetAmountMinor,
    recognitionAt: fact.recognitionAt,
    sourceDomain: fact.sourceDomain,
    sourceWatermark: fact._creationTime,
    storeId: fact.storeId,
  });
}

export async function recordOmittedProjectionEvidenceWithCtx(
  ctx: MutationCtx,
  input: {
    fact: Doc<"reportingFact">;
    generationId: Id<"reportingProjectionGeneration">;
    metric: string;
    now: number;
  },
) {
  if (await alreadyProjected(ctx, input.generationId, input.fact._id, input.metric)) {
    return false;
  }
  await insertEvidence(
    ctx,
    input.generationId,
    input.fact,
    input.metric,
    input.now,
    "omitted_missing_currency",
  );
  return true;
}

async function applyStoreDayContribution(
  ctx: MutationCtx,
  generation: Doc<"reportingProjectionGeneration">,
  fact: Doc<"reportingFact">,
  metric: string,
  value: number,
  now: number,
) {
  if (await alreadyProjected(ctx, generation._id, fact._id, metric)) return;
  const contributionCurrency = currencyForFactMetric(fact, metric);
  if (!QUANTITY_METRICS.has(metric) && contributionCurrency === undefined) {
    return;
  }
  if (!fact.timezoneVersionId || !fact.timezoneVersionHash) {
    throw new Error("Reporting fact requires timezone lineage");
  }
  const rows = await ctx.db
    .query("reportingStoreDayProjection")
    .withIndex("by_gen_date_metric_timezone", (q) =>
      q.eq("generationId", generation._id)
        .eq("operatingDate", fact.operatingDate)
        .eq("metric", metric)
        .eq("timezoneVersionId", fact.timezoneVersionId),
    )
    .take(2);
  if (rows.length > 1) {
    throw new Error("Store-day projection lineage identity is not unique");
  }
  const matchingRow = rows[0];
  if (matchingRow && !sameLineage(matchingRow, fact)) {
    throw new Error("Store-day projection lineage hash is incompatible");
  }
  if (matchingRow) {
    const mergedValue = mergeProjectionValue({
      currentCurrencyCode: matchingRow.currencyCode,
      currentKnownValue: matchingRow.knownValue,
      currentLimitingReason: matchingRow.limitingReason,
      incomingCurrencyCode: contributionCurrency,
      incomingValue: value,
    });
    await ctx.db.patch("reportingStoreDayProjection", matchingRow._id, {
      completeness:
        mergedValue.completeness ??
        (matchingRow.completeness === "complete" && fact.completeness === "complete"
          ? "complete"
          : "partial"),
      knownValue: mergedValue.knownValue,
      limitingReason:
        mergedValue.limitingReason ?? fact.limitingReason ?? matchingRow.limitingReason,
      projectedAt: now,
      sourceWatermark: Math.max(matchingRow.sourceWatermark, fact._creationTime),
    });
  } else {
    await ctx.db.insert("reportingStoreDayProjection", {
      completeness: fact.completeness,
      currencyCode: contributionCurrency,
      currencyMinorUnitScale: minorUnitScaleForFactMetric(fact, metric),
      generationId: generation._id,
      knownValue: value,
      limitingReason: fact.limitingReason,
      metric,
      metricContractVersion: generation.metricContractVersion,
      operatingDate: fact.operatingDate,
      organizationId: fact.organizationId,
      projectedAt: now,
      ...lineageFields(fact),
      sourceWatermark: fact._creationTime,
      storeId: fact.storeId,
    });
  }
  await insertEvidence(ctx, generation._id, fact, metric, now);
}

async function applySkuDayContribution(
  ctx: MutationCtx,
  generation: Doc<"reportingProjectionGeneration">,
  fact: Doc<"reportingFact">,
  metric: string,
  value: number,
  now: number,
) {
  const attributedProductSkuId = attributedProjectionProductSkuId(fact);
  if (!attributedProductSkuId) return;
  if (await alreadyProjected(ctx, generation._id, fact._id, metric)) return;
  const contributionCurrency = currencyForFactMetric(fact, metric);
  if (!QUANTITY_METRICS.has(metric) && contributionCurrency === undefined) {
    return;
  }
  if (!fact.timezoneVersionId || !fact.timezoneVersionHash) {
    throw new Error("Reporting fact requires timezone lineage");
  }
  const rows = await ctx.db
    .query("reportingSkuDayProjection")
    .withIndex("by_gen_sku_date_metric_timezone", (q) =>
      q.eq("generationId", generation._id)
        .eq("productSkuId", attributedProductSkuId)
        .eq("operatingDate", fact.operatingDate)
        .eq("metric", metric)
        .eq("timezoneVersionId", fact.timezoneVersionId),
    )
    .take(2);
  if (rows.length > 1) {
    throw new Error("SKU-day projection lineage identity is not unique");
  }
  const matchingRow = rows[0];
  if (matchingRow && !sameLineage(matchingRow, fact)) {
    throw new Error("SKU-day projection lineage hash is incompatible");
  }
  if (matchingRow) {
    const mergedValue = mergeProjectionValue({
      currentCurrencyCode: matchingRow.currencyCode,
      currentKnownValue: matchingRow.knownValue,
      currentLimitingReason: matchingRow.limitingReason,
      incomingCurrencyCode: contributionCurrency,
      incomingValue: value,
    });
    await ctx.db.patch("reportingSkuDayProjection", matchingRow._id, {
      completeness:
        mergedValue.completeness ??
        (matchingRow.completeness === "complete" && fact.completeness === "complete"
          ? "complete"
          : "partial"),
      knownValue: mergedValue.knownValue,
      limitingReason:
        mergedValue.limitingReason ?? fact.limitingReason ?? matchingRow.limitingReason,
      projectedAt: now,
      sourceWatermark: Math.max(matchingRow.sourceWatermark, fact._creationTime),
    });
  } else {
    await ctx.db.insert("reportingSkuDayProjection", {
      completeness: fact.completeness,
      currencyCode: contributionCurrency,
      currencyMinorUnitScale: minorUnitScaleForFactMetric(fact, metric),
      generationId: generation._id,
      knownValue: value,
      limitingReason: fact.limitingReason,
      metric,
      metricContractVersion: generation.metricContractVersion,
      operatingDate: fact.operatingDate,
      organizationId: fact.organizationId,
      productSkuId: attributedProductSkuId,
      projectedAt: now,
      ...lineageFields(fact),
      sourceWatermark: fact._creationTime,
      storeId: fact.storeId,
    });
  }
  await insertEvidence(ctx, generation._id, fact, metric, now);
}

async function refreshPreviousSkuProjectionMetadataWithCtx(
  ctx: MutationCtx,
  input: {
    fact: Doc<"reportingFact">;
    generation: Doc<"reportingProjectionGeneration">;
    metric: string;
    previousProductSkuId: Id<"productSku">;
    previousRowId: Id<"reportingSkuDayProjection">;
  },
) {
  const remainingEvidence = await ctx.db
    .query("reportingProjectionEvidence")
    .withIndex("by_generationId_productSkuId_operatingDate_metric", (q) =>
      q
        .eq("generationId", input.generation._id)
        .eq("productSkuId", input.previousProductSkuId)
        .eq("operatingDate", input.fact.operatingDate)
        .eq("metric", input.metric),
    )
    .filter((q) =>
      q.neq(q.field("disposition"), "omitted_missing_currency"),
    )
    .take(101);
  if (remainingEvidence.length === 0) {
    await ctx.db.delete("reportingSkuDayProjection", input.previousRowId);
    return;
  }
  const now = Date.now();
  if (remainingEvidence.length > 100) {
    await ctx.db.patch("reportingSkuDayProjection", input.previousRowId, {
      completeness: "stale",
      limitingReason: "rebuild_in_progress",
      projectedAt: now,
    });
    await ctx.db.patch("reportingProjectionGeneration", input.generation._id, {
      completeness: "stale",
      limitingReason: "rebuild_in_progress",
    });
    await upsertProjectionHealthWithCtx(ctx, {
      activeGenerationId: input.generation._id,
      factContractVersion: input.generation.factContractVersion,
      limitingReason: "rebuild_in_progress",
      metricContractVersion: input.generation.metricContractVersion,
      organizationId: input.generation.organizationId,
      processingWatermark: input.generation.sourceWatermark,
      projectionContractVersion: input.generation.projectionContractVersion,
      projectionKind: "sku_day",
      quarantinedCount: 0,
      sourceDomain: input.fact.sourceDomain,
      storeId: input.fact.storeId,
      updatedAt: now,
    });
    return;
  }
  await ctx.db.patch("reportingSkuDayProjection", input.previousRowId, {
    completeness: remainingEvidence.every(
      (evidence) => evidence.completeness === "complete",
    )
      ? "complete"
      : "partial",
    limitingReason: remainingEvidence.find(
      (evidence) => evidence.limitingReason !== undefined,
    )?.limitingReason,
    projectedAt: now,
    sourceWatermark: Math.max(
      ...remainingEvidence.map(
        (evidence) => evidence.sourceWatermark ?? evidence.recognitionAt,
      ),
    ),
  });
}

export async function reattributeFactInActiveSkuProjectionWithCtx(
  ctx: MutationCtx,
  input: {
    attributionKind: "pending_checkout";
    attributionVersion: number;
    canonicalProductSkuId: Id<"productSku">;
    fact: Doc<"reportingFact">;
    originalProductSkuId: Id<"productSku">;
  },
) {
  const generation = await activeGeneration(ctx, input.fact.storeId, "sku_day");
  const previousProductSkuId = attributedProjectionProductSkuId(input.fact);
  if (
    !generation ||
    !previousProductSkuId ||
    previousProductSkuId === input.canonicalProductSkuId
  ) {
    return { movedMetricCount: 0 };
  }
  const evidenceRows = await ctx.db
    .query("reportingProjectionEvidence")
    .withIndex("by_generationId_factId_metric", (q) =>
      q.eq("generationId", generation._id).eq("factId", input.fact._id),
    )
    .filter((q) =>
      q.neq(q.field("disposition"), "omitted_missing_currency"),
    )
    .take(50);
  const contributionByMetric = new Map(
    deriveFactMetricContributions(input.fact).map((row) => [row.metric, row]),
  );
  const now = Date.now();
  let movedMetricCount = 0;
  for (const evidence of evidenceRows) {
    if (evidence.productSkuId === input.canonicalProductSkuId) continue;
    const contribution = contributionByMetric.get(
      evidence.metric as ReturnType<
        typeof deriveFactMetricContributions
      >[number]["metric"],
    );
    if (!contribution) continue;
    const [previousRow, canonicalRow] = await Promise.all([
      ctx.db
        .query("reportingSkuDayProjection")
        .withIndex("by_generationId_productSkuId_operatingDate_metric", (q) =>
          q
            .eq("generationId", generation._id)
            .eq("productSkuId", previousProductSkuId)
            .eq("operatingDate", input.fact.operatingDate)
            .eq("metric", evidence.metric),
        )
        .first(),
      ctx.db
        .query("reportingSkuDayProjection")
        .withIndex("by_generationId_productSkuId_operatingDate_metric", (q) =>
          q
            .eq("generationId", generation._id)
            .eq("productSkuId", input.canonicalProductSkuId)
            .eq("operatingDate", input.fact.operatingDate)
            .eq("metric", evidence.metric),
        )
        .first(),
    ]);
    if (!previousRow || previousRow.knownValue === undefined) {
      throw new Error(
        "Provisional SKU projection contribution requires rebuild",
      );
    }
    const currencyCode = currencyForFactMetric(input.fact, evidence.metric);
    const currencyMinorUnitScale = minorUnitScaleForFactMetric(
      input.fact,
      evidence.metric,
    );
    await ctx.db.patch("reportingSkuDayProjection", previousRow._id, {
      knownValue: previousRow.knownValue - contribution.value,
      projectedAt: now,
    });
    if (canonicalRow) {
      if (
        canonicalRow.knownValue === undefined ||
        canonicalRow.currencyCode !== currencyCode
      ) {
        throw new Error(
          "Canonical SKU projection contribution requires rebuild",
        );
      }
      await ctx.db.patch("reportingSkuDayProjection", canonicalRow._id, {
        completeness:
          canonicalRow.completeness === "complete" &&
          input.fact.completeness === "complete"
            ? "complete"
            : "partial",
        knownValue: canonicalRow.knownValue + contribution.value,
        projectedAt: now,
        sourceWatermark: Math.max(
          canonicalRow.sourceWatermark,
          input.fact._creationTime,
        ),
      });
    } else {
      await ctx.db.insert("reportingSkuDayProjection", {
        completeness: input.fact.completeness,
        currencyCode,
        currencyMinorUnitScale,
        generationId: generation._id,
        knownValue: contribution.value,
        limitingReason: input.fact.limitingReason,
        metric: evidence.metric,
        metricContractVersion: generation.metricContractVersion,
        operatingDate: input.fact.operatingDate,
        organizationId: input.fact.organizationId,
        productSkuId: input.canonicalProductSkuId,
        projectedAt: now,
        ...lineageFields(input.fact),
        sourceWatermark: input.fact._creationTime,
        storeId: input.fact.storeId,
      });
    }
    await ctx.db.patch("reportingProjectionEvidence", evidence._id, {
      attributionKind: input.attributionKind,
      attributionVersion: input.attributionVersion,
      originalProductSkuId: input.originalProductSkuId,
      productSkuId: input.canonicalProductSkuId,
      provisionalProductSkuId: input.originalProductSkuId,
    });
    await refreshPreviousSkuProjectionMetadataWithCtx(ctx, {
      fact: input.fact,
      generation,
      metric: evidence.metric,
      previousProductSkuId,
      previousRowId: previousRow._id,
    });
    movedMetricCount += 1;
  }
  if (movedMetricCount > 0 && generation.status === "active") {
    await Promise.all([
      scheduleActiveSkuInsightRefreshWithCtx(ctx, {
        operatingDate: input.fact.operatingDate,
        productSkuId: previousProductSkuId,
        storeId: input.fact.storeId,
      }),
      scheduleActiveSkuInsightRefreshWithCtx(ctx, {
        operatingDate: input.fact.operatingDate,
        productSkuId: input.canonicalProductSkuId,
        storeId: input.fact.storeId,
      }),
    ]);
  }
  return { movedMetricCount };
}

export async function applyFactToGenerationWithCtx(
  ctx: MutationCtx,
  generation: Doc<"reportingProjectionGeneration">,
  fact: Doc<"reportingFact">,
) {
  if (
    generation.projectionKind !== "store_day" &&
    generation.projectionKind !== "sku_day"
  ) {
    throw new Error("Canonical facts require a daily projection generation");
  }
  const contributions = deriveFactMetricContributions(fact);
  const now = Date.now();
  const contributionEligibility = contributions.map((contribution) => ({
    contribution,
    disposition: factContributionProjectionEligibility({
      fact,
      metric: contribution.metric,
      projectionKind: generation.projectionKind,
    }),
  }));
  const projectedContributions = contributionEligibility
    .filter(({ disposition }) => disposition === "project")
    .map(({ contribution }) => contribution);
  const omittedCandidates = contributionEligibility
    .filter(({ disposition }) => disposition === "missing_currency")
    .map(({ contribution }) => contribution);
  const omittedContributions: typeof projectedContributions = [];
  for (const contribution of omittedCandidates) {
    if (
      await recordOmittedProjectionEvidenceWithCtx(ctx, {
        fact,
        generationId: generation._id,
        metric: contribution.metric,
        now,
      })
    ) {
      omittedContributions.push(contribution);
    }
  }
  for (const contribution of projectedContributions) {
    if (generation.projectionKind === "store_day") {
      await applyStoreDayContribution(
        ctx,
        generation,
        fact,
        contribution.metric,
        contribution.value,
        now,
      );
    } else if (generation.projectionKind === "sku_day") {
      await applySkuDayContribution(
        ctx,
        generation,
        fact,
        contribution.metric,
        contribution.value,
        now,
      );
    }
  }
  await updateMetricCoverageForFactWithCtx(ctx, {
    contributions: projectedContributions,
    fact,
    generation,
    omittedContributions,
    projectedAt: now,
  });
  if (generation.projectionKind === "store_day") {
    await applyDailyCloseFactWithCtx(ctx, generation, fact);
  }
  await upsertProjectionHealthWithCtx(ctx, {
    activeGenerationId:
      generation.status === "active" ? generation._id : undefined,
    factContractVersion: generation.factContractVersion,
    freshnessLagMs: Math.max(0, now - fact.acceptedAt),
    metricContractVersion: generation.metricContractVersion,
    organizationId: generation.organizationId,
    processingWatermark: Math.max(
      generation.sourceWatermark,
      fact._creationTime,
    ),
    projectionContractVersion: generation.projectionContractVersion,
    projectionKind: generation.projectionKind,
    quarantinedCount: 0,
    sourceDomain: fact.sourceDomain,
    storeId: generation.storeId,
    updatedAt: now,
  });
}

export const processCanonicalFacts = internalMutation({
  args: { factIds: v.array(v.id("reportingFact")) },
  handler: async (ctx, args) => {
    if (args.factIds.length === 0 || args.factIds.length > 20) {
      throw new Error("Projection batches require between 1 and 20 facts");
    }
    const facts = await Promise.all(
      args.factIds.map((factId) => ctx.db.get("reportingFact", factId)),
    );
    for (const fact of facts) {
      if (!fact || fact.status !== "canonical") continue;
      const [storeGeneration, skuGeneration] = await Promise.all([
        activeGeneration(ctx, fact.storeId, "store_day"),
        activeGeneration(ctx, fact.storeId, "sku_day"),
      ]);
      if (storeGeneration) {
        await applyFactToGenerationWithCtx(ctx, storeGeneration, fact);
      }
      if (skuGeneration) {
        await applyFactToGenerationWithCtx(ctx, skuGeneration, fact);
      }
      const attributedProductSkuId = attributedProjectionProductSkuId(fact);
      if (attributedProductSkuId && skuGeneration?.status === "active") {
        await scheduleActiveSkuInsightRefreshWithCtx(ctx, {
          operatingDate: fact.operatingDate,
          productSkuId: attributedProductSkuId,
          storeId: fact.storeId,
        });
      }
      for (const generation of [storeGeneration, skuGeneration]) {
        if (generation && generation.sourceWatermark < fact._creationTime) {
          await ctx.db.patch("reportingProjectionGeneration", generation._id, {
            sourceWatermark: fact._creationTime,
          });
        }
      }
      await ctx.db.patch(
        "reportingFact",
        fact._id,
        completedProjectionWorkPatch(fact, Date.now()),
      );
    }
  },
});
