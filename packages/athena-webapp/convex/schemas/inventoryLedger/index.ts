import { v } from "convex/values";

export const reportingSourceDomainSchema = v.union(
  v.literal("pos"),
  v.literal("storefront"),
  v.literal("service"),
  v.literal("payments"),
  v.literal("inventory"),
  v.literal("procurement"),
  v.literal("daily_close"),
);

export const reportingCompletenessSchema = v.union(
  v.literal("complete"),
  v.literal("provisional"),
  v.literal("partial"),
  v.literal("stale"),
  v.literal("unavailable"),
);

const reportingInventoryCostLaneSchema = v.union(
  v.literal("merchandise_cogs"),
  v.literal("exchange_merchandise_cogs"),
  v.literal("inventory_consumed"),
  v.literal("inventory_loss"),
  v.literal("inventory_adjustment"),
);

const reportingInventoryEffectCostLaneSchema = v.union(
  reportingInventoryCostLaneSchema,
  v.literal("historical_merchandise_cogs"),
  v.literal("historical_exchange_merchandise_cogs"),
  v.literal("historical_inventory_consumed"),
  v.literal("historical_inventory_loss"),
  v.literal("historical_inventory_adjustment"),
);

const inboundCostBasisSchema = v.union(
  v.object({ kind: v.literal("uncosted") }),
  v.object({
    kind: v.literal("known"),
    currency: v.string(),
    quantity: v.number(),
    totalCost: v.number(),
    unitCost: v.union(v.number(), v.null()),
  }),
);

const outboundDispositionSchema = v.union(
  v.literal("merchandise_sale"),
  v.literal("exchange_replacement"),
  v.literal("service_consumption"),
  v.literal("inventory_expense"),
  v.literal("damage"),
  v.literal("writeoff"),
  v.literal("stock_correction"),
);

const returnDispositionSchema = v.union(
  v.literal("sellable"),
  v.literal("non_restocked"),
  v.literal("damaged"),
  v.literal("missing"),
  v.literal("financial_only"),
);

const outboundBasisSchema = v.object({
  allocatedKnownCost: v.number(),
  basisVersion: v.number(),
  costedQuantity: v.number(),
  currency: v.union(v.string(), v.null()),
  knownCostPoolBefore: v.number(),
  roundedWeightedAverageUnitCost: v.union(v.number(), v.null()),
  uncostedQuantity: v.number(),
  unresolvedDeficitQuantity: v.number(),
});

const reportingInventoryReplayValuationSchema = v.union(
  v.object({ kind: v.literal("availability_only") }),
  v.object({
    costBasis: inboundCostBasisSchema,
    kind: v.literal("inbound"),
    quantity: v.number(),
  }),
  v.object({
    disposition: outboundDispositionSchema,
    kind: v.literal("outbound"),
    quantity: v.number(),
  }),
  v.object({
    disposition: returnDispositionSchema,
    financialContribution: v.union(
      v.literal("reverse_original_lane"),
      v.literal("none"),
    ),
    kind: v.literal("return"),
    originalBasis: outboundBasisSchema,
    originalCostLane: reportingInventoryCostLaneSchema,
    quantity: v.number(),
  }),
  v.object({
    costedQuantity: v.number(),
    currency: v.optional(v.string()),
    kind: v.literal("valuation_correction"),
    knownCostPoolMinor: v.number(),
    uncostedQuantity: v.number(),
    unresolvedDeficitQuantity: v.number(),
  }),
);

export const reportingInventoryPositionSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  productSkuId: v.id("productSku"),
  mode: v.union(v.literal("compatibility_shadow"), v.literal("authoritative")),
  onHandQuantity: v.number(),
  sellableQuantity: v.number(),
  costedQuantity: v.number(),
  uncostedQuantity: v.number(),
  unresolvedDeficitQuantity: v.number(),
  knownCostPoolMinor: v.number(),
  currencyCode: v.optional(v.string()),
  currencyMinorUnitScale: v.optional(v.number()),
  valuationStatus: v.optional(
    v.union(v.literal("current"), v.literal("rebuild_required")),
  ),
  valuationPendingFrom: v.optional(v.number()),
  deficitLedgerId: v.optional(v.id("reportingInventoryDeficitLedger")),
  lastEffectAt: v.number(),
  version: v.number(),
  updatedAt: v.number(),
});

export const reportingInventoryPositionRevisionSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  positionId: v.id("reportingInventoryPosition"),
  productSkuId: v.id("productSku"),
  effectId: v.optional(v.id("reportingInventoryEffect")),
  revisionKind: v.union(
    v.literal("effect_applied"),
    v.literal("baseline_applied"),
    v.literal("rebuild_applied"),
  ),
  recordedAt: v.number(),
});

export const reportingInventoryEffectSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  productSkuId: v.id("productSku"),
  positionId: v.optional(v.id("reportingInventoryPosition")),
  sourceDomain: reportingSourceDomainSchema,
  businessEventKey: v.string(),
  effectType: v.union(
    v.literal("receipt"),
    v.literal("sale"),
    v.literal("return"),
    v.literal("adjustment"),
    v.literal("transfer"),
    v.literal("deficit_resolution"),
    v.literal("baseline"),
  ),
  occurrenceAt: v.number(),
  operatingDate: v.optional(v.string()),
  scheduleVersionId: v.optional(v.id("storeSchedule")),
  physicalQuantityDelta: v.number(),
  sellableQuantityDelta: v.number(),
  returnedQuantity: v.optional(v.number()),
  returnDisposition: v.optional(returnDispositionSchema),
  replayValuation: v.optional(reportingInventoryReplayValuationSchema),
  knownCostPoolDeltaMinor: v.number(),
  outboundBasisMinor: v.optional(v.number()),
  costLane: v.optional(reportingInventoryEffectCostLaneSchema),
  cogsReversalKnownMinor: v.optional(v.number()),
  linkedOutboundEffectId: v.optional(v.id("reportingInventoryEffect")),
  revaluedQuantity: v.optional(v.number()),
  costedQuantityDelta: v.number(),
  uncostedQuantityDelta: v.number(),
  unresolvedDeficitDelta: v.number(),
  currencyCode: v.optional(v.string()),
  currencyMinorUnitScale: v.optional(v.number()),
  contentFingerprint: v.string(),
  completeness: reportingCompletenessSchema,
  valuationStatus: v.optional(
    v.union(v.literal("current"), v.literal("rebuild_required")),
  ),
  projectionStatus: v.optional(
    v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
  ),
  projectionAttemptCount: v.optional(v.number()),
  projectionLastAttemptAt: v.optional(v.number()),
  projectionLatestFailureAt: v.optional(v.number()),
  projectionLatestFailureCode: v.optional(v.string()),
  projectedAt: v.optional(v.number()),
  createdAt: v.number(),
});

export const reportingInventoryEffectSourceReferenceSchema = v.object({
  effectId: v.id("reportingInventoryEffect"),
  storeId: v.id("store"),
  sourceType: v.string(),
  sourceId: v.string(),
  relation: v.string(),
  createdAt: v.number(),
});

export const reportingInventoryDeficitLotSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  positionId: v.id("reportingInventoryPosition"),
  ledgerId: v.optional(v.id("reportingInventoryDeficitLedger")),
  productSkuId: v.id("productSku"),
  outboundEffectId: v.id("reportingInventoryEffect"),
  costLane: reportingInventoryCostLaneSchema,
  occurredAt: v.number(),
  remainingQuantity: v.number(),
  status: v.union(v.literal("open"), v.literal("resolved")),
  createdAt: v.number(),
  updatedAt: v.number(),
  resolvedAt: v.optional(v.number()),
});

export const reportingInventoryDeficitLedgerSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  positionId: v.id("reportingInventoryPosition"),
  productSkuId: v.id("productSku"),
  status: v.union(
    v.literal("candidate"),
    v.literal("active"),
    v.literal("superseded"),
    v.literal("abandoned"),
  ),
  createdAt: v.number(),
  activatedAt: v.optional(v.number()),
  supersededAt: v.optional(v.number()),
});

export const reportingInventoryDeficitResolutionWorkSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  positionId: v.id("reportingInventoryPosition"),
  productSkuId: v.id("productSku"),
  inboundEffectId: v.id("reportingInventoryEffect"),
  ledgerId: v.id("reportingInventoryDeficitLedger"),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
  ),
  totalResolutionQuantity: v.number(),
  resolvedQuantity: v.number(),
  remainingQuantity: v.number(),
  totalReceiptQuantity: v.number(),
  totalReceiptCostMinor: v.optional(v.number()),
  allocatedDeficitCostMinor: v.number(),
  currencyCode: v.optional(v.string()),
  currencyMinorUnitScale: v.optional(v.number()),
  occurrenceAt: v.number(),
  operatingDate: v.optional(v.string()),
  scheduleVersionId: v.optional(v.id("storeSchedule")),
  attemptCount: v.number(),
  latestFailureAt: v.optional(v.number()),
  latestFailureCode: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
});

export const reportingSkuValuationCorrectionSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  productSkuId: v.id("productSku"),
  inventoryEffectId: v.id("reportingInventoryEffect"),
  requestKey: v.string(),
  actorUserId: v.id("athenaUser"),
  reason: v.string(),
  priorInventoryCount: v.number(),
  correctedInventoryCount: v.number(),
  priorQuantityAvailable: v.number(),
  correctedQuantityAvailable: v.number(),
  priorUnitCostMinor: v.optional(v.number()),
  correctedUnitCostMinor: v.optional(v.number()),
  priorKnownCostPoolMinor: v.number(),
  correctedKnownCostPoolMinor: v.number(),
  currencyCode: v.optional(v.string()),
  correctionKind: v.optional(
    v.union(v.literal("prospective"), v.literal("exact_basis_compensation")),
  ),
  compensatesCorrectionId: v.optional(v.id("reportingSkuValuationCorrection")),
  priorBasisVersion: v.optional(v.number()),
  correctedBasisVersion: v.optional(v.number()),
  priorCostedQuantity: v.optional(v.number()),
  correctedCostedQuantity: v.optional(v.number()),
  priorUncostedQuantity: v.optional(v.number()),
  correctedUncostedQuantity: v.optional(v.number()),
  priorCurrencyCode: v.optional(v.string()),
  currencyMinorUnitScale: v.optional(v.number()),
  occurredAt: v.number(),
  createdAt: v.number(),
});

