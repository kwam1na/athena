export type SkuInsightCostCoverage =
  | "known"
  | "partial"
  | "unknown"
  | "mixed_currency";

export function buildSkuInsightProjection(input: {
  activeDays: number;
  confirmedInboundQuantity: number;
  inventoryCostCoverage: SkuInsightCostCoverage;
  revenueCostCoverage: SkuInsightCostCoverage;
  coveredEligibleRevenueMinor: number;
  eligibleMerchandiseRevenueMinor: number;
  expectedInboundAt?: number;
  knownCogsMinor: number;
  knownGrossProfitMinor: number;
  knownInventoryValueMinor: number | null;
  netSoldUnits: number;
  onHandQuantity: number;
  sellableQuantity: number;
  outstandingCommitmentQuantity: number;
  returnedUnits: number;
  shortReceipt: boolean;
  sourceGenerationIds: string[];
  sourceWatermark: number;
  uncostedOnHandQuantity: number;
  uncoveredEligibleRevenueMinor: number;
  windowEndDate: string;
  windowStartDate: string;
}) {
  const velocitySufficient = input.activeDays >= 7 && input.netSoldUnits >= 3;
  const averageUnitsPerActiveDay = velocitySufficient
    ? input.netSoldUnits / input.activeDays
    : null;
  const projectedDaysOfCover =
    averageUnitsPerActiveDay !== null && averageUnitsPerActiveDay > 0
      ? Math.floor(input.sellableQuantity / averageUnitsPerActiveDay)
      : null;
  const coverageBasisAvailable =
    input.revenueCostCoverage !== "mixed_currency" &&
    input.eligibleMerchandiseRevenueMinor > 0;
  const marginBasisAvailable =
    input.revenueCostCoverage !== "mixed_currency" &&
    input.coveredEligibleRevenueMinor > 0;
  return {
    ...input,
    averageUnitsPerActiveDay,
    costCoverageBasisPoints: coverageBasisAvailable
      ? Math.floor(
          (input.coveredEligibleRevenueMinor * 10_000) /
            input.eligibleMerchandiseRevenueMinor,
        )
      : null,
    marginBasisPoints:
      marginBasisAvailable
        ? Math.floor(
            (input.knownGrossProfitMinor * 10_000) /
              input.coveredEligibleRevenueMinor,
          )
        : null,
    projectedDaysOfCover,
    sourceGenerationIds: [...new Set(input.sourceGenerationIds)].sort(),
    velocitySufficient,
  };
}

export function countActiveDaysInDeclaredWindow(input: {
  dateExceptions: Array<{
    closed: boolean;
    localDate: string;
    windows: unknown[];
  }>;
  weeklyClosedDays: number[];
  weeklyWindows: Array<{ dayOfWeek: number }>;
  windowEndDate: string;
  windowStartDate: string;
}) {
  let cursor = new Date(`${input.windowStartDate}T12:00:00.000Z`);
  const end = new Date(`${input.windowEndDate}T12:00:00.000Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) {
    throw new Error("SKU insight active-day window is invalid");
  }
  let activeDays = 0;
  while (cursor <= end) {
    const localDate = cursor.toISOString().slice(0, 10);
    const exception = input.dateExceptions.find(
      (candidate) => candidate.localDate === localDate,
    );
    const active = exception
      ? !exception.closed && exception.windows.length > 0
      : !input.weeklyClosedDays.includes(cursor.getUTCDay()) &&
        input.weeklyWindows.some(
          (window) => window.dayOfWeek === cursor.getUTCDay(),
        );
    if (active) activeDays += 1;
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return activeDays;
}

export function summarizeRefundVoidCorrections(
  facts: Array<{
    amountMinor?: number;
    factType: string;
    status: string;
  }>,
) {
  const canonical = facts.filter(
    (fact) =>
      fact.status === "canonical" &&
      ["refund", "void", "correction"].includes(fact.factType),
  );
  return {
    count: canonical.length,
    valueMinor: canonical.reduce(
      (sum, fact) => sum + (fact.amountMinor ?? 0),
      0,
    ),
  };
}

const SKU_INSIGHT_BATCH_LIMIT = 50;
const SKU_INSIGHT_ROW_LIMIT = 500;
const skuInsightInternal = (internal as any).reporting.projections;

const COMPLETENESS_RANK = {
  complete: 0,
  provisional: 1,
  partial: 2,
  stale: 3,
  unavailable: 4,
} as const;

type Completeness = keyof typeof COMPLETENESS_RANK;

function worstCompleteness(values: Completeness[]) {
  return values.reduce<Completeness>(
    (worst, value) =>
      COMPLETENESS_RANK[value] > COMPLETENESS_RANK[worst] ? value : worst,
    "complete",
  );
}

function sumMetric(rows: Doc<"reportingSkuDayProjection">[], metric: string) {
  return rows
    .filter((row) => row.metric === metric)
    .reduce((sum, row) => sum + (row.knownValue ?? 0), 0);
}

function assertVerifiedSource(
  source: Doc<"reportingProjectionGeneration"> | null,
  kind: "sku_day" | "current_inventory" | "attention",
  storeId?: Id<"store">,
) {
  if (
    !source ||
    source.projectionKind !== kind ||
    (source.status !== "verified" && source.status !== "active") ||
    source.stableWatermark === undefined ||
    (storeId !== undefined && source.storeId !== storeId)
  ) {
    throw new Error(`Verified ${kind} source generation is unavailable`);
  }
  return source;
}

function isoDateDaysBefore(operatingDate: string, days: number) {
  const date = new Date(`${operatingDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("SKU insight date is invalid");
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function activeSourceGeneration(
  ctx: MutationCtx,
  storeId: Id<"store">,
  projectionKind: "sku_day" | "current_inventory" | "attention",
) {
  const activation = await ctx.db
    .query("reportingProjectionActivation")
    .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
      q.eq("storeId", storeId).eq("projectionKind", projectionKind),
    )
    .order("desc")
    .first();
  return activation
    ? ctx.db.get("reportingProjectionGeneration", activation.generationId)
    : null;
}

async function activeInsightSources(ctx: MutationCtx, storeId: Id<"store">) {
  const [skuDay, currentInventory, attention] = await Promise.all([
    activeSourceGeneration(ctx, storeId, "sku_day"),
    activeSourceGeneration(ctx, storeId, "current_inventory"),
    activeSourceGeneration(ctx, storeId, "attention"),
  ]);
  if (!skuDay || !currentInventory) return null;
  return {
    attentionGenerationId: attention?._id,
    currentInventoryGenerationId: currentInventory._id,
    skuDayGenerationId: skuDay._id,
  };
}

async function declaredActiveWindow(
  ctx: MutationCtx,
  storeId: Id<"store">,
  windowEndDate: string,
) {
  const windowStartDate = isoDateDaysBefore(windowEndDate, 27);
  const endAt = new Date(`${windowEndDate}T23:59:59.999Z`).getTime();
  const schedules = (
    await Promise.all(
      (["active", "superseded"] as const).map((status) =>
        ctx.db
          .query("storeSchedule")
          .withIndex("by_storeId_status_effectiveFrom", (q) =>
            q
              .eq("storeId", storeId)
              .eq("status", status)
              .lte("effectiveFrom", endAt),
          )
          .order("desc")
          .take(100),
      ),
    )
  )
    .flat()
    .sort((left, right) => right.effectiveFrom - left.effectiveFrom);
  const usedScheduleIds = new Set<Id<"storeSchedule">>();
  let activeDays = 0;
  let cursor = new Date(`${windowStartDate}T12:00:00.000Z`);
  const end = new Date(`${windowEndDate}T12:00:00.000Z`);
  while (cursor <= end) {
    const at = cursor.getTime();
    const schedule = schedules.find(
      (candidate) =>
        candidate.effectiveFrom <= at &&
        (candidate.effectiveTo === undefined || at < candidate.effectiveTo),
    );
    if (schedule) {
      usedScheduleIds.add(schedule._id);
      const operatingDate = cursor.toISOString().slice(0, 10);
      activeDays += countActiveDaysInDeclaredWindow({
        dateExceptions: schedule.dateExceptions,
        weeklyClosedDays: schedule.weeklyClosedDays,
        weeklyWindows: schedule.weeklyWindows,
        windowEndDate: operatingDate,
        windowStartDate: operatingDate,
      });
    }
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  if (usedScheduleIds.size === 0) {
    throw new Error("SKU insight schedule coverage is unavailable");
  }
  return {
    activeDays,
    windowEndDate,
    windowScheduleVersionIds: [...usedScheduleIds].sort((left, right) =>
      String(left).localeCompare(String(right)),
    ),
    windowStartDate,
  };
}

export async function scheduleActiveSkuInsightRefreshWithCtx(
  ctx: MutationCtx,
  input: {
    operatingDate: string;
    productSkuId: Id<"productSku">;
    storeId: Id<"store">;
  },
) {
  await ctx.scheduler.runAfter(
    0,
    skuInsightInternal.skuInsights.refreshActiveSkuInsight,
    input,
  );
}

async function materializeSkuWithCtx(
  ctx: MutationCtx,
  input: {
    activeDays: number;
    attentionGeneration: Doc<"reportingProjectionGeneration"> | null;
    currentInventoryGeneration: Doc<"reportingProjectionGeneration">;
    now: number;
    productSkuId: Id<"productSku">;
    skuDayGeneration: Doc<"reportingProjectionGeneration">;
    windowEndDate: string;
    windowScheduleVersionIds: Id<"storeSchedule">[];
    windowStartDate: string;
  },
) {
  const [
    windowRows,
    commitmentRows,
    inventoryRows,
    procurementFacts,
    refundFacts,
    voidFacts,
    correctionFacts,
  ] =
    await Promise.all([
      ctx.db
        .query("reportingSkuDayProjection")
        .withIndex("by_generationId_productSkuId_operatingDate_metric", (q) =>
          q
            .eq("generationId", input.skuDayGeneration._id)
            .eq("productSkuId", input.productSkuId)
            .gte("operatingDate", input.windowStartDate)
            .lte("operatingDate", input.windowEndDate),
        )
        .take(SKU_INSIGHT_ROW_LIMIT + 1),
      ctx.db
        .query("reportingSkuDayProjection")
        .withIndex("by_generationId_productSkuId_operatingDate_metric", (q) =>
          q
            .eq("generationId", input.skuDayGeneration._id)
            .eq("productSkuId", input.productSkuId),
        )
        .take(SKU_INSIGHT_ROW_LIMIT + 1),
      ctx.db
        .query("reportingCurrentValuationProjection")
        .withIndex("by_generationId_productSkuId_metric", (q) =>
          q
            .eq("generationId", input.currentInventoryGeneration._id)
            .eq("productSkuId", input.productSkuId),
        )
        .take(10),
      ctx.db
        .query("reportingFact")
        .withIndex("by_storeId_productSkuId_sourceDomain_recognitionAt", (q) =>
          q
            .eq("storeId", input.skuDayGeneration.storeId)
            .eq("productSkuId", input.productSkuId)
            .eq("sourceDomain", "procurement"),
        )
        .order("desc")
        .take(SKU_INSIGHT_ROW_LIMIT + 1),
      ...(["refund", "void", "correction"] as const).map((factType) =>
        ctx.db
          .query("reportingFact")
          .withIndex("by_storeId_productSkuId_factType_operatingDate", (q) =>
            q
              .eq("storeId", input.skuDayGeneration.storeId)
              .eq("productSkuId", input.productSkuId)
              .eq("factType", factType)
              .gte("operatingDate", input.windowStartDate)
              .lte("operatingDate", input.windowEndDate),
          )
          .take(SKU_INSIGHT_ROW_LIMIT + 1),
      ),
    ]);
  const adjustmentFacts = [refundFacts, voidFacts, correctionFacts].flat();
  const truncated =
    windowRows.length > SKU_INSIGHT_ROW_LIMIT ||
    commitmentRows.length > SKU_INSIGHT_ROW_LIMIT ||
    procurementFacts.length > SKU_INSIGHT_ROW_LIMIT ||
    [refundFacts, voidFacts, correctionFacts].some(
      (facts) => facts.length > SKU_INSIGHT_ROW_LIMIT,
    );
  const boundedWindowRows = windowRows.slice(0, SKU_INSIGHT_ROW_LIMIT);
  const boundedCommitmentRows = commitmentRows.slice(0, SKU_INSIGHT_ROW_LIMIT);
  const boundedFacts = procurementFacts.slice(0, SKU_INSIGHT_ROW_LIMIT);
  const onHandRow = inventoryRows.find((row) => row.metric === "on_hand_units");
  const sellableRow = inventoryRows.find(
    (row) => row.metric === "sellable_units",
  );
  const inventoryValueRow = inventoryRows.find(
    (row) => row.metric === "inventory_value",
  );
  const eligibleMerchandiseRevenueMinor = sumMetric(
    boundedWindowRows,
    "net_sales",
  );
  const uncoveredEligibleRevenueMinor = Math.max(
    0,
    sumMetric(boundedWindowRows, "uncosted_revenue"),
  );
  const coveredEligibleRevenueMinor = Math.max(
    0,
    eligibleMerchandiseRevenueMinor - uncoveredEligibleRevenueMinor,
  );
  const uncostedOnHandQuantity = inventoryValueRow?.unknownQuantity ?? 0;
  const revenueMoneyRows = boundedWindowRows.filter((row) =>
    ["net_sales", "uncosted_revenue"].includes(row.metric),
  );
  const valuationMoneyRows = boundedWindowRows.filter((row) =>
    ["known_cogs", "gross_profit"].includes(row.metric),
  );
  const revenueCurrencies = new Set(
    revenueMoneyRows
      .map((row) => row.currencyCode)
      .filter((currency): currency is string => Boolean(currency)),
  );
  const valuationCurrencies = new Set(
    valuationMoneyRows
      .map((row) => row.currencyCode)
      .filter((currency): currency is string => Boolean(currency)),
  );
  const revenueMixedCurrency =
    revenueCurrencies.size > 1 ||
    valuationCurrencies.size > 1 ||
    (revenueCurrencies.size === 1 &&
      valuationCurrencies.size === 1 &&
      [...revenueCurrencies][0] !== [...valuationCurrencies][0]) ||
    [...revenueMoneyRows, ...valuationMoneyRows].some(
      (row) => row.limitingReason === "mixed_currency",
    );
  const inventoryMixedCurrency = inventoryRows.some(
    (row) => row.limitingReason === "mixed_currency",
  );
  const revenueCostCoverage: SkuInsightCostCoverage = revenueMixedCurrency
    ? "mixed_currency"
    : uncoveredEligibleRevenueMinor > 0
      ? coveredEligibleRevenueMinor > 0
        ? "partial"
        : "unknown"
      : "known";
  const inventoryCostCoverage: SkuInsightCostCoverage = inventoryMixedCurrency
    ? "mixed_currency"
    : uncostedOnHandQuantity > 0
      ? Math.max(
          0,
          (onHandRow?.knownValue ?? 0) - uncostedOnHandQuantity,
        ) > 0
        ? "partial"
        : "unknown"
      : "known";
  const relevantCommitments = boundedCommitmentRows.filter(
    (row) => row.metric === "purchase_commitment_units",
  );
  const outstandingCommitmentQuantity = Math.max(
    0,
    relevantCommitments.reduce((sum, row) => sum + (row.knownValue ?? 0), 0),
  );
  const commitmentsByLine = new Map<
    string,
    { confirmed: boolean; expectedAt?: number; quantity: number }
  >();
  for (const fact of [...boundedFacts].reverse()) {
    if (fact.status !== "canonical" || !fact.sourceLineKey) continue;
    const current = commitmentsByLine.get(fact.sourceLineKey) ?? {
      confirmed: false,
      quantity: 0,
    };
    if (fact.factType === "procurement_commitment") {
      current.quantity += fact.quantity ?? 0;
    } else if (fact.factType === "procurement_receipt") {
      current.quantity -= Math.abs(fact.quantity ?? 0);
    }
    if (fact.commitmentConfirmed !== undefined) {
      current.confirmed = fact.commitmentConfirmed;
    }
    if (fact.expectedInboundAt !== undefined) {
      current.expectedAt = fact.expectedInboundAt;
    }
    commitmentsByLine.set(fact.sourceLineKey, current);
  }
  const confirmedCommitments = [...commitmentsByLine.values()].filter(
    (commitment) => commitment.confirmed && commitment.quantity > 0,
  );
  const confirmedInboundQuantity = confirmedCommitments.reduce(
    (sum, commitment) => sum + commitment.quantity,
    0,
  );
  const expectedInboundAt = confirmedCommitments.reduce<number | undefined>(
    (earliest, commitment) =>
      commitment.expectedAt === undefined
        ? earliest
        : earliest === undefined
          ? commitment.expectedAt
          : Math.min(earliest, commitment.expectedAt),
    undefined,
  );
  const shortReceipt = boundedFacts.some(
    (fact) =>
      fact.status === "canonical" && fact.procurementSignal === "short_receipt",
  );
  const adjustmentSummary = summarizeRefundVoidCorrections(adjustmentFacts);
  const refundVoidCorrectionCount = adjustmentSummary.count;
  const refundVoidCorrectionMinor = adjustmentSummary.valueMinor;
  const sourceCompleteness = worstCompleteness([
    input.skuDayGeneration.completeness,
    input.currentInventoryGeneration.completeness,
    ...boundedWindowRows.map((row) => row.completeness),
    ...inventoryRows.map((row) => row.completeness),
    ...(truncated || !onHandRow || !sellableRow || !inventoryValueRow
      ? (["partial"] as const)
      : []),
  ]);
  const projection = buildSkuInsightProjection({
    activeDays: input.activeDays,
    confirmedInboundQuantity,
    inventoryCostCoverage,
    revenueCostCoverage,
    coveredEligibleRevenueMinor,
    eligibleMerchandiseRevenueMinor,
    expectedInboundAt,
    knownCogsMinor: sumMetric(boundedWindowRows, "known_cogs"),
    knownGrossProfitMinor: sumMetric(boundedWindowRows, "gross_profit"),
    knownInventoryValueMinor: inventoryValueRow?.knownValue ?? null,
    netSoldUnits: sumMetric(boundedWindowRows, "units_sold"),
    onHandQuantity: onHandRow?.knownValue ?? 0,
    sellableQuantity: sellableRow?.knownValue ?? 0,
    outstandingCommitmentQuantity,
    returnedUnits: sumMetric(boundedWindowRows, "units_returned"),
    shortReceipt,
    sourceGenerationIds: [
      String(input.skuDayGeneration._id),
      String(input.currentInventoryGeneration._id),
    ],
    sourceWatermark: Math.min(
      input.skuDayGeneration.stableWatermark!,
      input.currentInventoryGeneration.stableWatermark!,
    ),
    uncostedOnHandQuantity,
    uncoveredEligibleRevenueMinor,
    windowEndDate: input.windowEndDate,
    windowStartDate: input.windowStartDate,
  });
  const existing = await ctx.db
    .query("reportingSkuInsightProjection")
    .withIndex("by_generationId_productSkuId", (q) =>
      q
        .eq("generationId", input.skuDayGeneration._id)
        .eq("productSkuId", input.productSkuId),
    )
    .take(2);
  if (existing.length > 1) throw new Error("SKU insight identity is duplicated");
  const value: Omit<Doc<"reportingSkuInsightProjection">, "_id" | "_creationTime"> = {
    activeDays: projection.activeDays,
    averageUnitsPerActiveDay: projection.averageUnitsPerActiveDay ?? undefined,
    completeness: sourceCompleteness,
    confirmedInboundQuantity: projection.confirmedInboundQuantity,
    inventoryCostCoverage: projection.inventoryCostCoverage,
    revenueCostCoverage: projection.revenueCostCoverage,
    costCoverageBasisPoints: projection.costCoverageBasisPoints ?? undefined,
    coveredEligibleRevenueMinor: projection.coveredEligibleRevenueMinor,
    currencyCode: inventoryValueRow?.currencyCode,
    currencyMinorUnitScale: inventoryValueRow?.currencyMinorUnitScale,
    eligibleMerchandiseRevenueMinor: projection.eligibleMerchandiseRevenueMinor,
    expectedInboundAt: projection.expectedInboundAt,
    factContractVersion: input.skuDayGeneration.factContractVersion,
    generationId: input.skuDayGeneration._id,
    knownCogsMinor: projection.knownCogsMinor,
    knownGrossProfitMinor: projection.knownGrossProfitMinor,
    knownInventoryValueMinor: projection.knownInventoryValueMinor ?? undefined,
    limitingReason: revenueMixedCurrency || inventoryMixedCurrency
      ? "mixed_currency"
      : truncated
        ? "evidence_truncated"
        : sourceCompleteness === "complete"
          ? undefined
          : "source_incomplete",
    marginBasisPoints: projection.marginBasisPoints ?? undefined,
    metricContractVersion: input.skuDayGeneration.metricContractVersion,
    netSoldUnits: projection.netSoldUnits,
    onHandQuantity: projection.onHandQuantity,
    organizationId: input.skuDayGeneration.organizationId,
    outstandingCommitmentQuantity: projection.outstandingCommitmentQuantity,
    productSkuId: input.productSkuId,
    projectedAt: input.now,
    projectedDaysOfCover: projection.projectedDaysOfCover ?? undefined,
    projectionContractVersion: input.skuDayGeneration.projectionContractVersion,
    refundVoidCorrectionCount,
    refundVoidCorrectionMinor,
    revenueCurrencyCode:
      revenueCurrencies.size === 1 ? [...revenueCurrencies][0] : undefined,
    revenueCurrencyMinorUnitScale: revenueMoneyRows.find(
      (row) => row.currencyMinorUnitScale !== undefined,
    )?.currencyMinorUnitScale,
    returnedUnits: projection.returnedUnits,
    sellableQuantity: projection.sellableQuantity,
    shortReceipt: projection.shortReceipt,
    sourceGenerationIds: [
      input.currentInventoryGeneration._id,
      input.skuDayGeneration._id,
    ].sort((left, right) => String(left).localeCompare(String(right))),
    sourceWatermark: projection.sourceWatermark,
    storeId: input.skuDayGeneration.storeId,
    uncostedOnHandQuantity: projection.uncostedOnHandQuantity,
    valuationCurrencyCode:
      valuationCurrencies.size === 1
        ? [...valuationCurrencies][0]
        : undefined,
    valuationCurrencyMinorUnitScale: valuationMoneyRows.find(
      (row) => row.currencyMinorUnitScale !== undefined,
    )?.currencyMinorUnitScale,
    uncoveredEligibleRevenueMinor: projection.uncoveredEligibleRevenueMinor,
    velocitySufficient: projection.velocitySufficient,
    windowEndDate: projection.windowEndDate,
    windowScheduleVersionIds: input.windowScheduleVersionIds,
    windowStartDate: projection.windowStartDate,
  };
  const rowId = existing[0]
    ? (await ctx.db.patch("reportingSkuInsightProjection", existing[0]._id, value),
      existing[0]._id)
    : await ctx.db.insert("reportingSkuInsightProjection", value);
  if (input.attentionGeneration) {
    await ctx.scheduler.runAfter(
      0,
      skuInsightInternal.attention.materializeAttentionProjection,
      {
        attentionGenerationId: input.attentionGeneration._id,
        completenessBySource: [
          {
            completeness: input.currentInventoryGeneration.completeness,
            generationId: input.currentInventoryGeneration._id,
            limitingReason: input.currentInventoryGeneration.limitingReason,
          },
          {
            completeness: input.skuDayGeneration.completeness,
            generationId: input.skuDayGeneration._id,
            limitingReason: input.skuDayGeneration.limitingReason,
          },
        ],
        productSkuId: input.productSkuId,
        scope: "sku",
        values: {
          activeDays: projection.activeDays,
          confirmedInboundQuantity: projection.confirmedInboundQuantity,
          expectedInboundAt: projection.expectedInboundAt,
          grossRecognizedSalesMinor: projection.eligibleMerchandiseRevenueMinor,
          netSoldUnits: projection.netSoldUnits,
          now: input.now,
          projectedDaysOfCover: projection.projectedDaysOfCover,
          refundVoidCorrectionCount,
          refundVoidCorrectionMinor,
          shortReceipt: projection.shortReceipt,
          uncostedEligibleRevenueMinor: projection.uncoveredEligibleRevenueMinor,
          uncostedOnHandQuantity: projection.uncostedOnHandQuantity,
        },
      },
    );
  }
  return rowId;
}

export const materializeSkuInsightBatch = internalMutation({
  args: {
    activeDays: v.number(),
    attentionGenerationId: v.optional(v.id("reportingProjectionGeneration")),
    currentInventoryGenerationId: v.id("reportingProjectionGeneration"),
    productSkuIds: v.array(v.id("productSku")),
    skuDayGenerationId: v.id("reportingProjectionGeneration"),
    windowEndDate: v.string(),
    windowScheduleVersionIds: v.array(v.id("storeSchedule")),
    windowStartDate: v.string(),
  },
  handler: async (ctx, args) => {
    if (
      args.productSkuIds.length === 0 ||
      args.productSkuIds.length > SKU_INSIGHT_BATCH_LIMIT ||
      args.activeDays < 0 ||
      args.activeDays > 366
    ) {
      throw new Error("SKU insight batch bounds are invalid");
    }
    const [rawSkuDay, rawCurrentInventory, rawAttention] = await Promise.all([
      ctx.db.get("reportingProjectionGeneration", args.skuDayGenerationId),
      ctx.db.get(
        "reportingProjectionGeneration",
        args.currentInventoryGenerationId,
      ),
      args.attentionGenerationId
        ? ctx.db.get("reportingProjectionGeneration", args.attentionGenerationId)
        : null,
    ]);
    const skuDayGeneration = assertVerifiedSource(rawSkuDay, "sku_day");
    const currentInventoryGeneration = assertVerifiedSource(
      rawCurrentInventory,
      "current_inventory",
      skuDayGeneration.storeId,
    );
    const attentionGeneration = rawAttention
      ? assertVerifiedSource(rawAttention, "attention", skuDayGeneration.storeId)
      : null;
    for (const source of [currentInventoryGeneration, attentionGeneration]) {
      if (
        source &&
        (source.organizationId !== skuDayGeneration.organizationId ||
          source.factContractVersion !== skuDayGeneration.factContractVersion ||
          source.metricContractVersion !== skuDayGeneration.metricContractVersion ||
          source.projectionContractVersion !==
            skuDayGeneration.projectionContractVersion)
      ) {
        throw new Error("SKU insight source generation is incompatible");
      }
    }
    const now = Date.now();
    const rowIds = [];
    for (const productSkuId of args.productSkuIds) {
      const sku = await ctx.db.get("productSku", productSkuId);
      if (!sku || sku.storeId !== skuDayGeneration.storeId) continue;
      rowIds.push(
        await materializeSkuWithCtx(ctx, {
          activeDays: args.activeDays,
          attentionGeneration,
          currentInventoryGeneration,
          now,
          productSkuId,
          skuDayGeneration,
          windowEndDate: args.windowEndDate,
          windowScheduleVersionIds: args.windowScheduleVersionIds,
          windowStartDate: args.windowStartDate,
        }),
      );
    }
    return rowIds;
  },
});

export const refreshActiveSkuInsight = internalMutation({
  args: {
    operatingDate: v.string(),
    productSkuId: v.id("productSku"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const sources = await activeInsightSources(ctx, args.storeId);
    if (!sources) return null;
    const window = await declaredActiveWindow(ctx, args.storeId, args.operatingDate);
    await ctx.scheduler.runAfter(
      0,
      skuInsightInternal.skuInsights.materializeSkuInsightBatch,
      {
        ...window,
        ...sources,
        productSkuIds: [args.productSkuId],
      },
    );
    return sources;
  },
});

export const refreshActiveSkuInsightPage = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    operatingDate: v.string(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const sources = await activeInsightSources(ctx, args.storeId);
    if (!sources) return null;
    const window = await declaredActiveWindow(ctx, args.storeId, args.operatingDate);
    const page = await ctx.db
      .query("productSku")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .paginate({ cursor: args.cursor ?? null, numItems: SKU_INSIGHT_BATCH_LIMIT });
    if (page.page.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        skuInsightInternal.skuInsights.materializeSkuInsightBatch,
        {
          ...window,
          ...sources,
          productSkuIds: page.page.map((sku) => sku._id),
        },
      );
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        skuInsightInternal.skuInsights.refreshActiveSkuInsightPage,
        {
          cursor: page.continueCursor,
          operatingDate: args.operatingDate,
          storeId: args.storeId,
        },
      );
    }
    return { isDone: page.isDone, processedCount: page.page.length };
  },
});
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../../_generated/server";
