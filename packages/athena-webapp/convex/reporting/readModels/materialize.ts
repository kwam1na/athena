import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import { v } from "convex/values";
import { resolveReportingOperatingPeriodWithCtx } from "../operatingPeriods";
import { resolveReportPeriod } from "../periods";
import { classifySkuSummary } from "./reportingReadModels";

const PAGE_SIZE = 20;
const PRESETS = [["today", "today"], ["wtd", "week_to_date"], ["prior_week", "prior_week"], ["trailing_30", "trailing_30_days"]] as const;
type PresetIndex = 0 | 1 | 2 | 3;
type WorkspaceGeneration = Doc<"reportingProjectionGeneration"> & { stableWatermark: number; workspaceEpochId: Id<"reportingWorkspaceMaterializationEpoch"> };

function addMetric(metrics: Record<string, number | null>, metric: string, value?: number) {
  return { ...metrics, [metric]: value === undefined || metrics[metric] === null ? null : (metrics[metric] ?? 0) + value };
}

function completeness(current: string | undefined, incoming: string) {
  return current === "partial" || incoming !== "complete" ? "partial" as const : "complete" as const;
}

function rangeContains(date: string, range: { startDate: string; endDate: string }) {
  return date >= range.startDate && date <= range.endDate;
}

export function accumulateCustomActiveDays(current: number, metric: string) {
  return current + (metric.startsWith("__active_day:") ? 1 : 0);
}

export function accumulateCustomActiveDates(current: string[], metric: string) {
  if (!metric.startsWith("__active_day:")) return current;
  return [...new Set([...current, metric.slice("__active_day:".length)])].sort();
}

export function selectReadableWorkspaceEpochId(input: {
  activeEpochId: string | null;
  candidateEpoch: { epochId: string; status: "building" | "verified" | "active" | "retired" } | null;
}) {
  return input.candidateEpoch?.status === "active"
    ? input.candidateEpoch.epochId
    : input.activeEpochId;
}

export function workspaceEpochNeedsRefresh(input: { epochWatermark: number; sourceWatermark: number }) {
  return input.epochWatermark !== input.sourceWatermark;
}

export function materializationPageMatchesEpoch(
  epoch: { cursor?: string; phase?: string; presetIndex: number; sequence: number },
  page: { cursor?: string | null; phase?: string; presetIndex?: number; sequence: number },
) {
  return page.sequence === epoch.sequence && (page.cursor ?? null) === (epoch.cursor ?? null) &&
    (page.phase ?? "source") === (epoch.phase ?? "source") && (page.presetIndex ?? 0) === epoch.presetIndex;
}

async function scheduleNext(ctx: MutationCtx, args: { cursor: string | null; epochId: Id<"reportingWorkspaceMaterializationEpoch">; generationId: Id<"reportingProjectionGeneration">; phase?: "source" | "facets"; presetIndex: PresetIndex }) {
  const state = await ctx.db.get("reportingWorkspaceMaterializationEpoch", args.epochId);
  if (state?.status !== "building") return;
  const sequence = state.sequence + 1;
  await ctx.db.patch(state._id, { cursor: args.cursor ?? undefined, leaseToken: undefined, phase: args.phase, presetIndex: args.presetIndex, sequence, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, (internal as any).reporting.readModels.materialize.materializeActiveReportsWorkspace, { ...args, sequence });
}

async function completeMaterialization(ctx: MutationCtx, epochId: Id<"reportingWorkspaceMaterializationEpoch">) {
  const state = await ctx.db.get("reportingWorkspaceMaterializationEpoch", epochId);
  if (!state || state.status !== "building") return;
  const now = Date.now();
  await ctx.db.patch(state._id, { cursor: undefined, status: "verified", updatedAt: now, verifiedAt: now });
  await ctx.scheduler.runAfter(0, (internal as any).reporting.readModels.materialize.activateVerifiedReportsWorkspaceEpoch, { epochId });
}

async function addFacet(ctx: MutationCtx, generation: WorkspaceGeneration, periodKey: string, range: { startDate: string; endDate: string }, value: string) {
  const existing = await ctx.db.query("reportingPeriodFacet").withIndex("by_epoch_period_facet_value", (q) => q.eq("workspaceEpochId", generation.workspaceEpochId).eq("periodKey", periodKey).eq("facet", "classification").eq("value", value)).first();
  const row = { completeness: "complete" as const, count: (existing?.count ?? 0) + 1, facet: "classification", generationId: generation._id, workspaceEpochId: generation.workspaceEpochId, organizationId: generation.organizationId, periodKey, projectedAt: Date.now(), rangeEndDate: range.endDate, rangeStartDate: range.startDate, sourceGenerationIds: [generation._id], sourceWatermark: generation.stableWatermark, storeId: generation.storeId, value };
  if (existing) await ctx.db.replace(existing._id, row); else await ctx.db.insert("reportingPeriodFacet", row);
}

async function upsertClassificationMembership(ctx: MutationCtx, row: Doc<"reportingSkuPeriodSummary">, classification: string) {
  const existing = await ctx.db.query("reportingSkuPeriodClassification").withIndex("by_epoch_period_class_sku", (q) => q.eq("workspaceEpochId", row.workspaceEpochId).eq("periodKey", row.periodKey).eq("classification", classification).eq("productSkuId", row.productSkuId)).first();
  const value = { attentionSort: row.attentionSort, classification, coverSort: row.coverSort, generationId: row.generationId, inventoryValueSort: row.inventoryValueSort, marginSort: row.marginSort, periodKey: row.periodKey, productSkuId: row.productSkuId, revenueSort: row.revenueSort, unitsSort: row.unitsSort, workspaceEpochId: row.workspaceEpochId };
  if (existing) await ctx.db.replace(existing._id, value); else await ctx.db.insert("reportingSkuPeriodClassification", value);
}

async function materializeStoreRow(ctx: MutationCtx, generation: WorkspaceGeneration, periodKey: string, range: { startDate: string; endDate: string }, row: Doc<"reportingStoreDayProjection">) {
  if (!rangeContains(row.operatingDate, range)) return;
  const existing = await ctx.db.query("reportingStorePeriodSummary").withIndex("by_workspaceEpochId_periodKey", (q) => q.eq("workspaceEpochId", generation.workspaceEpochId).eq("periodKey", periodKey)).first();
  const mixedCurrency = Boolean(existing?.revenueCurrencyCode && row.currencyCode && existing.revenueCurrencyCode !== row.currencyCode);
  const summary = {
    completeness: mixedCurrency ? "partial" as const : completeness(existing?.completeness, row.completeness),
 generationId: generation._id, workspaceEpochId: generation.workspaceEpochId,
    limitingReason: mixedCurrency ? "mixed_currency" as const : existing?.limitingReason ?? row.limitingReason,
    metrics: mixedCurrency ? { ...(existing?.metrics ?? {}), [row.metric]: null } : addMetric(existing?.metrics ?? {}, row.metric, row.knownValue),
    organizationId: generation.organizationId, periodKey, projectedAt: Date.now(),
    rangeEndDate: range.endDate, rangeStartDate: range.startDate,
    revenueCurrencyCode: mixedCurrency ? undefined : existing?.revenueCurrencyCode ?? row.currencyCode,
    revenueCurrencyMinorUnitScale: mixedCurrency ? undefined : existing?.revenueCurrencyMinorUnitScale ?? row.currencyMinorUnitScale,
    sourceGenerationIds: [generation._id], sourceWatermark: generation.stableWatermark, storeId: generation.storeId,
  };
  if (existing) await ctx.db.replace(existing._id, summary); else await ctx.db.insert("reportingStorePeriodSummary", summary);
}

async function upsertRollup(ctx: MutationCtx, generation: WorkspaceGeneration, periodKey: string, range: { startDate: string; endDate: string }, dimension: "product" | "category", dimensionId: string, row: Doc<"reportingSkuDayProjection">) {
  const existing = await ctx.db.query("reportingPeriodRollup").withIndex("by_epoch_period_dimension_id", (q) => q.eq("workspaceEpochId", generation.workspaceEpochId).eq("periodKey", periodKey).eq("dimension", dimension).eq("dimensionId", dimensionId)).first();
  const result = { completeness: completeness(existing?.completeness, row.completeness), dimension, dimensionId, generationId: generation._id, workspaceEpochId: generation.workspaceEpochId, identityBasis: "recognition" as const, limitingReason: existing?.limitingReason ?? row.limitingReason, metrics: addMetric(existing?.metrics ?? {}, row.metric, row.knownValue), organizationId: generation.organizationId, periodKey, projectedAt: Date.now(), rangeEndDate: range.endDate, rangeStartDate: range.startDate, sourceGenerationIds: [generation._id], sourceWatermark: generation.stableWatermark, storeId: generation.storeId };
  if (existing) await ctx.db.replace(existing._id, result); else await ctx.db.insert("reportingPeriodRollup", result);
}

async function materializeSkuRow(ctx: MutationCtx, generation: WorkspaceGeneration, periodKey: string, range: { startDate: string; endDate: string }, row: Doc<"reportingSkuDayProjection">) {
  if (!rangeContains(row.operatingDate, range)) return;
  const existing = await ctx.db.query("reportingSkuPeriodSummary").withIndex("by_epoch_period_sku", (q) => q.eq("workspaceEpochId", generation.workspaceEpochId).eq("periodKey", periodKey).eq("productSkuId", row.productSkuId)).first();
  const metrics = addMetric(existing?.metrics ?? {}, row.metric, row.knownValue);
  const activeDays = (existing?.activeDays ?? 0) + (existing?.latestActiveOperatingDate === row.operatingDate ? 0 : 1);
  const revenue = metrics.net_sales ?? 0;
  const profit = metrics.merchandise_profit;
  const marginBasisPoints = profit !== null && profit !== undefined && revenue > 0 ? Math.round((profit / revenue) * 10_000) : undefined;
  const classifications = classifySkuSummary({ activeDays, marginBasisPoints, netRevenueMinor: revenue, netSoldUnits: metrics.units_sold ?? 0, projectedDaysOfCover: metrics.projected_days_of_cover ?? undefined });
  const sku = await ctx.db.get("productSku", row.productSkuId);
  const product = sku ? await ctx.db.get("product", sku.productId) : null;
  const result = { activeDays, attentionSort: classifications.length, classificationKey: classifications[0] ?? "all", classifications, completeness: completeness(existing?.completeness, row.completeness), coverSort: metrics.projected_days_of_cover ?? Number.NEGATIVE_INFINITY, generationId: generation._id, workspaceEpochId: generation.workspaceEpochId, inventoryValueSort: metrics.inventory_value ?? Number.NEGATIVE_INFINITY, latestActiveOperatingDate: row.operatingDate, limitingReason: existing?.limitingReason ?? row.limitingReason, marginSort: marginBasisPoints ?? Number.NEGATIVE_INFINITY, metrics, organizationId: generation.organizationId, periodKey, productSkuId: row.productSkuId, projectedAt: Date.now(), rangeEndDate: range.endDate, rangeStartDate: range.startDate, recognitionCategoryId: existing?.recognitionCategoryId ?? product?.categoryId, recognitionProductId: existing?.recognitionProductId ?? product?._id, revenueCurrencyCode: existing?.revenueCurrencyCode ?? row.currencyCode, revenueCurrencyMinorUnitScale: existing?.revenueCurrencyMinorUnitScale ?? row.currencyMinorUnitScale, revenueSort: metrics.net_sales ?? Number.NEGATIVE_INFINITY, sourceGenerationIds: [generation._id], sourceWatermark: generation.stableWatermark, storeId: generation.storeId, unitsSort: metrics.units_sold ?? Number.NEGATIVE_INFINITY };
  if (existing) await ctx.db.replace(existing._id, result); else await ctx.db.insert("reportingSkuPeriodSummary", result);
  if (product) await upsertRollup(ctx, generation, periodKey, range, "product", String(product._id), row);
  if (product?.categoryId) await upsertRollup(ctx, generation, periodKey, range, "category", String(product.categoryId), row);
  if (["units_sold", "units_returned", "inventory_consumed_units", "purchase_commitment_units", "inventory_adjustment_units", "inventory_received_units"].includes(row.metric)) {
    const movement = await ctx.db.query("reportingInventoryMovementSummary").withIndex("by_epoch_period_sku", (q) => q.eq("workspaceEpochId", generation.workspaceEpochId).eq("periodKey", periodKey).eq("productSkuId", row.productSkuId)).first();
    const field = ({ units_sold: "salesQuantity", units_returned: "returnsQuantity", inventory_consumed_units: "consumedQuantity", purchase_commitment_units: "commitmentQuantity", inventory_adjustment_units: "adjustmentsQuantity", inventory_received_units: "receiptsQuantity" } as const)[row.metric as "units_sold"];
    const base = { adjustmentsQuantity: movement?.adjustmentsQuantity ?? 0, commitmentQuantity: movement?.commitmentQuantity ?? 0, consumedQuantity: movement?.consumedQuantity ?? 0, receiptsQuantity: movement?.receiptsQuantity ?? 0, returnsQuantity: movement?.returnsQuantity ?? 0, salesQuantity: movement?.salesQuantity ?? 0 };
    base[field] += row.knownValue ?? 0;
    const movementRow = { ...base, completeness: completeness(movement?.completeness, row.completeness), generationId: generation._id, workspaceEpochId: generation.workspaceEpochId, limitingReason: movement?.limitingReason ?? row.limitingReason, organizationId: generation.organizationId, periodKey, productSkuId: row.productSkuId, projectedAt: Date.now(), rangeEndDate: range.endDate, rangeStartDate: range.startDate, sourceGenerationIds: [generation._id], sourceWatermark: generation.stableWatermark, storeId: generation.storeId };
    if (movement) await ctx.db.replace(movement._id, movementRow); else await ctx.db.insert("reportingInventoryMovementSummary", movementRow);
    const total = await ctx.db.query("reportingInventoryPeriodSummary").withIndex("by_workspaceEpochId_periodKey", (q) => q.eq("workspaceEpochId", generation.workspaceEpochId).eq("periodKey", periodKey)).first();
    const totalRow = { completeness: completeness(total?.completeness, row.completeness), generationId: generation._id, workspaceEpochId: generation.workspaceEpochId, limitingReason: total?.limitingReason ?? row.limitingReason, metrics: addMetric(total?.metrics ?? {}, row.metric, row.knownValue), organizationId: generation.organizationId, periodKey, projectedAt: Date.now(), rangeEndDate: range.endDate, rangeStartDate: range.startDate, sourceGenerationIds: [generation._id], sourceWatermark: generation.stableWatermark, storeId: generation.storeId };
    if (total) await ctx.db.replace(total._id, totalRow); else await ctx.db.insert("reportingInventoryPeriodSummary", totalRow);
  }
}

async function materializeInventoryRow(ctx: MutationCtx, generation: WorkspaceGeneration, row: Doc<"reportingCurrentValuationProjection">) {
  const existing = await ctx.db.query("reportingInventoryExposureSummary").withIndex("by_workspaceEpochId_productSkuId", (q) => q.eq("workspaceEpochId", generation.workspaceEpochId).eq("productSkuId", row.productSkuId)).first();
  const metrics = addMetric(existing?.metrics ?? {}, row.metric, row.knownValue);
  const result = { asOf: Math.max(existing?.asOf ?? 0, row.asOf), completeness: completeness(existing?.completeness, row.completeness), exposureSort: metrics.inventory_value ?? Number.NEGATIVE_INFINITY, generationId: generation._id, workspaceEpochId: generation.workspaceEpochId, limitingReason: existing?.limitingReason ?? row.limitingReason, metrics, organizationId: generation.organizationId, productSkuId: row.productSkuId, projectedAt: Date.now(), sourceWatermark: generation.stableWatermark, storeId: generation.storeId, valuationCurrencyCode: existing?.valuationCurrencyCode ?? row.currencyCode, valuationCurrencyMinorUnitScale: existing?.valuationCurrencyMinorUnitScale ?? row.currencyMinorUnitScale };
  if (existing) await ctx.db.replace(existing._id, result); else await ctx.db.insert("reportingInventoryExposureSummary", result);
}

export const materializeActiveReportsWorkspace = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), epochId: v.id("reportingWorkspaceMaterializationEpoch"), generationId: v.id("reportingProjectionGeneration"), phase: v.optional(v.union(v.literal("source"), v.literal("facets"))), presetIndex: v.optional(v.number()), sequence: v.number() },
  handler: async (ctx, args) => {
    const [sourceGeneration, materializationState] = await Promise.all([ctx.db.get("reportingProjectionGeneration", args.generationId), ctx.db.get("reportingWorkspaceMaterializationEpoch", args.epochId)]);
    if (materializationState?.status !== "building") return { status: materializationState?.status ?? "unavailable" };
    const expectedCursor = materializationState.cursor ?? null;
    if (!materializationPageMatchesEpoch(materializationState, args)) return { status: "stale_page" as const };
    await ctx.db.patch(materializationState._id, { leaseToken: `${args.sequence}:${expectedCursor ?? "start"}`, updatedAt: Date.now() });
    if (!sourceGeneration || materializationState.sourceGenerationId !== sourceGeneration._id || materializationState.sourceWatermark !== sourceGeneration.stableWatermark) return { status: "authority_changed" as const };
    const generation = { ...sourceGeneration, workspaceEpochId: materializationState._id };
    if (!generation || generation.stableWatermark === undefined ||
      (generation.status !== "active" && !(generation.projectionKind === "custom_range" && generation.status === "verified"))) return { status: "authority_changed" as const };
    const presetIndex = Math.min(3, Math.max(0, Math.floor(args.presetIndex ?? 0))) as PresetIndex;
    if (generation.projectionKind === "custom_range") {
      if (!generation.rangeStartDate || !generation.rangeEndDate) throw new Error("Custom Reports materialization range is unavailable");
      const periodKey = `${generation.rangeStartDate}:${generation.rangeEndDate}`;
      const customRange = { endDate: generation.rangeEndDate, startDate: generation.rangeStartDate };
      if (args.phase === "facets") {
        const facetPage = await ctx.db.query("reportingSkuPeriodSummary").withIndex("by_epoch_period_revenue_sku", (q) => q.eq("workspaceEpochId", generation.workspaceEpochId).eq("periodKey", periodKey)).paginate({ cursor: args.cursor ?? null, numItems: PAGE_SIZE });
        for (const row of facetPage.page) {
          await addFacet(ctx, generation as WorkspaceGeneration, periodKey, customRange, "all");
          for (const classification of row.classifications) { await addFacet(ctx, generation as WorkspaceGeneration, periodKey, customRange, classification); await upsertClassificationMembership(ctx, row, classification); }
        }
        if (!facetPage.isDone) await scheduleNext(ctx, { cursor: facetPage.continueCursor, epochId: args.epochId, generationId: generation._id, phase: "facets", presetIndex: 0 });
        if (facetPage.isDone) await completeMaterialization(ctx, args.epochId);
        return { processed: facetPage.page.length, status: facetPage.isDone ? "completed" as const : "running" as const };
      }
      const page = await ctx.db.query("reportingRangeProjection").withIndex("by_generationId_resultFamily_resultKey", (q) => q.eq("generationId", generation._id).eq("resultFamily", "sku")).paginate({ cursor: args.cursor ?? null, numItems: PAGE_SIZE });
      for (const row of page.page) {
        if (!row.productSkuId) continue;
        const existing = await ctx.db.query("reportingSkuPeriodSummary").withIndex("by_epoch_period_sku", (q) => q.eq("workspaceEpochId", generation.workspaceEpochId).eq("periodKey", periodKey).eq("productSkuId", row.productSkuId!)).first();
        const isActiveDayMarker = row.metric.startsWith("__active_day:");
        const activeOperatingDates = accumulateCustomActiveDates(existing?.activeOperatingDates ?? [], row.metric);
        const activeDays = activeOperatingDates.length;
        const metrics = isActiveDayMarker ? existing?.metrics ?? {} : addMetric(existing?.metrics ?? {}, row.metric, row.knownValue);
        const revenue = metrics.net_sales ?? 0;
        const profit = metrics.merchandise_profit;
        const marginBasisPoints = profit !== null && profit !== undefined && revenue > 0 ? Math.round((profit / revenue) * 10_000) : undefined;
        const classifications = classifySkuSummary({ activeDays, marginBasisPoints, netRevenueMinor: revenue, netSoldUnits: metrics.units_sold ?? 0, projectedDaysOfCover: metrics.projected_days_of_cover ?? undefined });
        const sku = await ctx.db.get("productSku", row.productSkuId);
        const product = sku ? await ctx.db.get("product", sku.productId) : null;
        const summary = { activeDays, activeOperatingDates, attentionSort: classifications.length, classificationKey: classifications[0] ?? "all", classifications, completeness: completeness(existing?.completeness, row.completeness), coverSort: metrics.projected_days_of_cover ?? Number.NEGATIVE_INFINITY, generationId: generation._id, workspaceEpochId: generation.workspaceEpochId, inventoryValueSort: metrics.inventory_value ?? Number.NEGATIVE_INFINITY, limitingReason: existing?.limitingReason ?? row.limitingReason, marginSort: marginBasisPoints ?? Number.NEGATIVE_INFINITY, metrics, organizationId: generation.organizationId, periodKey, productSkuId: row.productSkuId, projectedAt: Date.now(), rangeEndDate: generation.rangeEndDate, rangeStartDate: generation.rangeStartDate, recognitionCategoryId: product?.categoryId, recognitionProductId: product?._id, revenueCurrencyCode: existing?.revenueCurrencyCode ?? row.currencyCode, revenueCurrencyMinorUnitScale: existing?.revenueCurrencyMinorUnitScale ?? row.currencyMinorUnitScale, revenueSort: metrics.net_sales ?? Number.NEGATIVE_INFINITY, sourceGenerationIds: generation.sourceGenerationIds ?? [], sourceWatermark: generation.stableWatermark, storeId: generation.storeId, unitsSort: metrics.units_sold ?? Number.NEGATIVE_INFINITY };
        if (existing) await ctx.db.replace(existing._id, summary); else await ctx.db.insert("reportingSkuPeriodSummary", summary);
        if (["units_sold", "units_returned", "inventory_consumed_units", "purchase_commitment_units", "inventory_adjustment_units", "inventory_received_units"].includes(row.metric)) {
          const total = await ctx.db.query("reportingInventoryPeriodSummary").withIndex("by_workspaceEpochId_periodKey", (q) => q.eq("workspaceEpochId", generation.workspaceEpochId).eq("periodKey", periodKey)).first();
          const totalRow = { completeness: completeness(total?.completeness, row.completeness), generationId: generation._id, workspaceEpochId: generation.workspaceEpochId, limitingReason: total?.limitingReason ?? row.limitingReason, metrics: addMetric(total?.metrics ?? {}, row.metric, row.knownValue), organizationId: generation.organizationId, periodKey, projectedAt: Date.now(), rangeEndDate: generation.rangeEndDate, rangeStartDate: generation.rangeStartDate, sourceGenerationIds: generation.sourceGenerationIds ?? [], sourceWatermark: generation.stableWatermark, storeId: generation.storeId };
          if (total) await ctx.db.replace(total._id, totalRow); else await ctx.db.insert("reportingInventoryPeriodSummary", totalRow);
        }
      }
      if (!page.isDone) await scheduleNext(ctx, { cursor: page.continueCursor, epochId: args.epochId, generationId: generation._id, phase: "source", presetIndex: 0 });
      else await scheduleNext(ctx, { cursor: null, epochId: args.epochId, generationId: generation._id, phase: "facets", presetIndex: 0 });
      return { processed: page.page.length, status: "running" as const };
    }
    if (generation.projectionKind === "current_inventory") {
      const page = await ctx.db.query("reportingCurrentValuationProjection").withIndex("by_generationId_productSkuId_metric", (q) => q.eq("generationId", generation._id)).paginate({ cursor: args.cursor ?? null, numItems: PAGE_SIZE });
      for (const row of page.page) await materializeInventoryRow(ctx, generation as WorkspaceGeneration, row);
      if (!page.isDone) await scheduleNext(ctx, { cursor: page.continueCursor, epochId: args.epochId, generationId: generation._id, presetIndex });
      else await completeMaterialization(ctx, args.epochId);
      return { processed: page.page.length, status: page.isDone ? "completed" as const : "running" as const };
    }
    if (generation.projectionKind !== "store_day" && generation.projectionKind !== "sku_day") return { status: "unsupported" as const };
    const operating = await resolveReportingOperatingPeriodWithCtx(ctx, { occurrenceAt: Date.now(), storeId: generation.storeId });
    if (operating.kind !== "resolved") throw new Error("Reports materialization requires an active store schedule");
    const [periodKey, preset] = PRESETS[presetIndex];
    const range = resolveReportPeriod({ asOf: Date.now(), operatingDate: operating.operatingDate, operatingDayStartsAt: operating.startsAt, preset, scheduleVersionId: String(operating.scheduleVersionId), timezone: operating.timezone }).current;
    if (generation.projectionKind === "sku_day" && args.phase === "facets") {
      const facetPage = await ctx.db.query("reportingSkuPeriodSummary").withIndex("by_epoch_period_revenue_sku", (q) => q.eq("workspaceEpochId", generation.workspaceEpochId).eq("periodKey", periodKey)).paginate({ cursor: args.cursor ?? null, numItems: PAGE_SIZE });
      for (const row of facetPage.page) {
        await addFacet(ctx, generation as WorkspaceGeneration, periodKey, range, "all");
        for (const classification of row.classifications) {
          await addFacet(ctx, generation as WorkspaceGeneration, periodKey, range, classification);
          await upsertClassificationMembership(ctx, row, classification);
        }
      }
      if (!facetPage.isDone) await scheduleNext(ctx, { cursor: facetPage.continueCursor, epochId: args.epochId, generationId: generation._id, phase: "facets", presetIndex });
      else if (presetIndex < 3) await scheduleNext(ctx, { cursor: null, epochId: args.epochId, generationId: generation._id, phase: "source", presetIndex: (presetIndex + 1) as PresetIndex });
      if (facetPage.isDone && presetIndex === 3) await completeMaterialization(ctx, args.epochId);
      return { processed: facetPage.page.length, status: facetPage.isDone && presetIndex === 3 ? "completed" as const : "running" as const };
    }
    const page = generation.projectionKind === "store_day"
      ? await ctx.db.query("reportingStoreDayProjection").withIndex("by_generationId_operatingDate_metric", (q) => q.eq("generationId", generation._id)).paginate({ cursor: args.cursor ?? null, numItems: PAGE_SIZE })
      : await ctx.db.query("reportingSkuDayProjection").withIndex("by_generationId_operatingDate_productSkuId_metric", (q) => q.eq("generationId", generation._id)).paginate({ cursor: args.cursor ?? null, numItems: PAGE_SIZE });
    for (const row of page.page) {
      if (generation.projectionKind === "store_day") await materializeStoreRow(ctx, generation as WorkspaceGeneration, periodKey, range, row as Doc<"reportingStoreDayProjection">);
      else await materializeSkuRow(ctx, generation as WorkspaceGeneration, periodKey, range, row as Doc<"reportingSkuDayProjection">);
    }
    if (!page.isDone) await scheduleNext(ctx, { cursor: page.continueCursor, epochId: args.epochId, generationId: generation._id, presetIndex });
    else if (generation.projectionKind === "sku_day") await scheduleNext(ctx, { cursor: null, epochId: args.epochId, generationId: generation._id, phase: "facets", presetIndex });
    else if (presetIndex < PRESETS.length - 1) await scheduleNext(ctx, { cursor: null, epochId: args.epochId, generationId: generation._id, phase: "source", presetIndex: (presetIndex + 1) as PresetIndex });
    if (page.isDone && presetIndex === 3 && generation.projectionKind === "store_day") await completeMaterialization(ctx, args.epochId);
    return { processed: page.page.length, status: page.isDone && presetIndex === 3 && generation.projectionKind === "store_day" ? "completed" as const : "running" as const };
  },
});

export const startReportsWorkspaceMaterialization = internalMutation({
  args: { generationId: v.id("reportingProjectionGeneration") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get("reportingProjectionGeneration", args.generationId);
    if (!generation || generation.stableWatermark === undefined) return { status: "unavailable" as const };
    const epoch = await ctx.db.query("reportingWorkspaceMaterializationEpoch").withIndex("by_sourceGenerationId_sourceWatermark", (q) => q.eq("sourceGenerationId", generation._id).eq("sourceWatermark", generation.stableWatermark!)).first();
    if (epoch?.status === "active") return { epochId: epoch._id, status: "active" as const };
    if (epoch) {
      if (epoch.status === "building" && Date.now() - epoch.updatedAt > 300_000) await scheduleNext(ctx, { cursor: epoch.cursor ?? null, epochId: epoch._id, generationId: generation._id, phase: epoch.phase === "facets" ? "facets" : "source", presetIndex: Math.min(3, Math.max(0, epoch.presetIndex)) as PresetIndex });
      return { epochId: epoch._id, status: epoch.status };
    }
    const now = Date.now();
    const epochId = await ctx.db.insert("reportingWorkspaceMaterializationEpoch", { phase: "source", presetIndex: 0, projectionKind: generation.projectionKind, sequence: 0, sourceGenerationId: generation._id, sourceWatermark: generation.stableWatermark, startedAt: now, status: "building", storeId: generation.storeId, updatedAt: now });
    await scheduleNext(ctx, { cursor: null, epochId, generationId: generation._id, phase: "source", presetIndex: 0 });
    return { epochId, status: "building" as const };
  },
});

export const activateVerifiedReportsWorkspaceEpoch = internalMutation({
  args: { epochId: v.id("reportingWorkspaceMaterializationEpoch") },
  handler: async (ctx, args) => {
    const epoch = await ctx.db.get("reportingWorkspaceMaterializationEpoch", args.epochId);
    if (!epoch || epoch.status !== "verified") return { status: "not_ready" as const };
    const source = await ctx.db.get("reportingProjectionGeneration", epoch.sourceGenerationId);
    if (!source || source.status !== (source.projectionKind === "custom_range" ? "verified" : "active") || source.stableWatermark !== epoch.sourceWatermark) return { status: "authority_changed" as const };
    if (source.projectionKind === "store_day") {
      const readiness: { ready: boolean; sourceGenerationId: string; sourceWatermark: number } = await ctx.runQuery((internal as any).reporting.projections.storeIntraday.getHistoricalStoreIntradayReadiness, { sourceGenerationId: source._id, sourceWatermark: epoch.sourceWatermark });
      if (!readiness.ready || readiness.sourceGenerationId !== String(source._id) || readiness.sourceWatermark !== epoch.sourceWatermark) {
        await ctx.db.patch(epoch._id, { activationBlockedReason: "historical_intraday_not_ready", updatedAt: Date.now() });
        return { reason: "historical_intraday_not_ready" as const, status: "blocked" as const };
      }
    }
    const current = await ctx.db.query("reportingWorkspaceReadModelActivation").withIndex("by_storeId_projectionKind_activatedAt", (q) => q.eq("storeId", epoch.storeId).eq("projectionKind", epoch.projectionKind)).order("desc").first();
    const now = Date.now();
    if (current && current.supersededAt === undefined) {
      await ctx.db.patch(current._id, { supersededAt: now });
      await ctx.scheduler.runAfter(0, (internal as any).reporting.readModels.materialize.retireWorkspaceEpoch, { epochId: current.workspaceEpochId });
    }
    await ctx.db.insert("reportingWorkspaceReadModelActivation", { activatedAt: now, projectionKind: epoch.projectionKind, sourceGenerationId: epoch.sourceGenerationId, sourceWatermark: epoch.sourceWatermark, storeId: epoch.storeId, workspaceEpochId: epoch._id });
    await ctx.db.patch(epoch._id, { activatedAt: now, activationBlockedReason: undefined, status: "active", updatedAt: now });
    return { status: "active" as const, workspaceEpochId: epoch._id };
  },
});

export const retireWorkspaceEpoch = internalMutation({
  args: { epochId: v.id("reportingWorkspaceMaterializationEpoch") },
  handler: async (ctx, args) => {
    const epoch = await ctx.db.get("reportingWorkspaceMaterializationEpoch", args.epochId);
    if (epoch?.status === "active") await ctx.db.patch(epoch._id, { retiredAt: Date.now(), status: "retired", updatedAt: Date.now() });
  },
});

export const materializeActiveReportsWorkspaceForStore = internalMutation({
  args: { storeId: v.id("store") },
  handler: async (ctx, args) => {
    const scheduled: string[] = [];
    for (const projectionKind of ["store_day", "sku_day", "current_inventory"] as const) {
      const activation = await ctx.db.query("reportingProjectionActivation").withIndex("by_storeId_projectionKind_activatedAt", (q) => q.eq("storeId", args.storeId).eq("projectionKind", projectionKind)).order("desc").first();
      if (!activation || activation.supersededAt !== undefined) continue;
      await ctx.scheduler.runAfter(0, (internal as any).reporting.readModels.materialize.startReportsWorkspaceMaterialization, { generationId: activation.generationId });
      scheduled.push(String(activation.generationId));
    }
    return { ready: scheduled.length === 3, scheduledGenerationIds: scheduled };
  },
});

/** Production repair loop: discovers stores in bounded pages and starts missing/stale workspace materialization. */
export const resumeReportsWorkspaceMaterialization = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("store").paginate({ cursor: args.cursor ?? null, numItems: 10 });
    for (const store of page.page) {
      await ctx.scheduler.runAfter(0, (internal as any).reporting.readModels.materialize.materializeActiveReportsWorkspaceForStore, { storeId: store._id });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, (internal as any).reporting.readModels.materialize.resumeReportsWorkspaceMaterialization, { cursor: page.continueCursor });
    return { processedStores: page.page.length, status: page.isDone ? "completed" as const : "running" as const };
  },
});
