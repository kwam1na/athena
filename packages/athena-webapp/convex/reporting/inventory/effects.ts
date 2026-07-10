import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import {
  REPORTING_FACT_CONTRACT_VERSION,
  REPORTING_PROJECTION_CONTRACT_VERSION,
} from "../../../shared/reportingContract";
import {
  recordInventoryMovementWithDispositionWithCtx,
  type RecordInventoryMovementArgs,
} from "../../operations/inventoryMovements";
import { recordSkuActivityEventWithCtx } from "../../operations/skuActivity";
import {
  recordFactSkuEvidenceWithCtx,
  recordInventoryEffectSkuEvidenceWithCtx,
} from "../evidence";
import type {
  InboundCostBasis,
  InventoryOutboundDisposition,
  InventoryReturnDisposition,
  InventoryValuationPosition,
  OutboundValuationBasisSnapshot,
  UnresolvedDeficitLot,
  ValuationCostLane,
} from "./types";
import {
  applyInboundValuation,
  applyOutboundValuation,
  applyReturnValuation,
  applyValuationCorrection,
  getOutboundCostTreatment,
  knownUnitCostBasis,
  uncostedBasis,
} from "./valuation";
import {
  scheduleFactProjectionBatchWithCtx,
  scheduleInventoryEffectProjectionWithCtx,
} from "../projectionWork";
import { recordInventoryPositionRevisionWithCtx } from "./positionRevisions";
import {
  enqueueDeficitResolutionWorkWithCtx,
  resolveDeficitCoveredRevenueWithCtx,
} from "./deficitResolutionWork";
import { materializeGenerationCoverageWithCtx } from "../coverage";
import { upsertProjectionHealthWithCtx } from "../health";
import { ensureActiveDeficitLedgerWithCtx } from "./deficitLedger";

export type ReportingSourceDomain =
  | "pos"
  | "storefront"
  | "service"
  | "payments"
  | "inventory"
  | "procurement"
  | "daily_close";

export type ReportingInventoryEffectType =
  | "receipt"
  | "sale"
  | "return"
  | "adjustment"
  | "transfer"
  | "deficit_resolution"
  | "baseline";

export type ReportingCompleteness =
  "complete" | "provisional" | "partial" | "stale" | "unavailable";

export type InventoryEffectValuation =
  | {
      kind: "availability_only";
    }
  | {
      costBasis: InboundCostBasis;
      /** @deprecated Reporting owns and derives durable deficit lots. */
      deficitLots?: UnresolvedDeficitLot[];
      kind: "inbound";
      quantity: number;
    }
  | {
      disposition: InventoryOutboundDisposition;
      kind: "outbound";
      quantity: number;
    }
  | {
      /** @deprecated Reporting owns and derives durable deficit lots. */
      deficitLots?: UnresolvedDeficitLot[];
      disposition: InventoryReturnDisposition;
      financialContribution: "reverse_original_lane" | "none";
      kind: "return";
      originalBasis: OutboundValuationBasisSnapshot;
      originalCostLane: ValuationCostLane;
      quantity: number;
    };

export type ApplyInventoryEffectArgs = {
  activityStatus?: string;
  activityType: string;
  actorStaffProfileId?: Id<"staffProfile">;
  actorUserId?: Id<"athenaUser">;
  businessEventKey: string;
  completeness: ReportingCompleteness;
  compatibilityBalance?: {
    onHandQuantity: number;
    sellableQuantity: number;
  };
  contentFingerprint: string;
  customerProfileId?: Id<"customerProfile">;
  currencyMinorUnitScale?: number;
  effectType: ReportingInventoryEffectType;
  movementType: string;
  notes?: string;
  occurrenceAt: number;
  operatingDate?: string;
  organizationId: Id<"organization">;
  onlineOrderId?: Id<"onlineOrder">;
  physicalQuantityDelta: number;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  posTransactionId?: Id<"posTransaction">;
  reasonCode?: string;
  recordedAt?: number;
  scheduleVersionId?: Id<"storeSchedule">;
  registerSessionId?: Id<"registerSession">;
  sellableQuantityDelta: number;
  sourceDomain: ReportingSourceDomain;
  sourceId: string;
  sourceLineId?: string;
  sourceType: string;
  storeId: Id<"store">;
  valuation: InventoryEffectValuation;
  workItemId?: Id<"operationalWorkItem">;
};

type InventoryEffectResult = {
  adjustmentEffects: Array<Doc<"reportingInventoryEffect">>;
  disposition: "conflict" | "existing" | "inserted";
  effect: Doc<"reportingInventoryEffect">;
  mode: "authoritative" | "compatibility_shadow";
  movement: Doc<"inventoryMovement"> | null;
  position: Doc<"reportingInventoryPosition">;
};

type ValuationTransition = {
  adjustmentInputs: Array<{
    businessEventKey: string;
    contentFingerprint: string;
    costLane: string;
    currency: string;
    knownCost: number;
    outboundEffectId: string;
    quantity: number;
  }>;
  createdDeficitLot: UnresolvedDeficitLot | null;
  cogsReversalKnownMinor?: number;
  costLane?: ValuationCostLane;
  deferredDeficitQuantity: number;
  outboundBasisMinor?: number;
  position: InventoryValuationPosition;
  remainingDeficitLots: UnresolvedDeficitLot[];
};

function assertNonempty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function assertInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer.`);
  }
}

function positionToValuation(
  position: Doc<"reportingInventoryPosition">,
): InventoryValuationPosition {
  return {
    basisVersion: position.version,
    costedQuantity: position.costedQuantity,
    currency: position.currencyCode ?? null,
    knownCostPool: position.knownCostPoolMinor,
    uncostedQuantity: position.uncostedQuantity,
    unresolvedDeficitQuantity: position.unresolvedDeficitQuantity,
  };
}

function shadowValuationFromSku(
  productSku: Pick<Doc<"productSku">, "inventoryCount">,
): InventoryValuationPosition {
  return {
    basisVersion: 0,
    costedQuantity: 0,
    currency: null,
    knownCostPool: 0,
    uncostedQuantity: productSku.inventoryCount,
    unresolvedDeficitQuantity: 0,
  };
}

function onHandQuantity(position: InventoryValuationPosition): number {
  return position.costedQuantity + position.uncostedQuantity;
}

function normalizedCurrency(currency: string | null | undefined) {
  return currency?.trim().toUpperCase() ?? null;
}

function hasValuationCurrencyConflict(
  position: InventoryValuationPosition,
  valuation: InventoryEffectValuation,
) {
  const currentCurrency = normalizedCurrency(position.currency);
  if (!currentCurrency) return false;
  if (valuation.kind === "inbound" && valuation.costBasis.kind === "known") {
    return normalizedCurrency(valuation.costBasis.currency) !== currentCurrency;
  }
  if (
    valuation.kind === "return" &&
    valuation.disposition === "sellable" &&
    valuation.originalBasis.costedQuantity > 0
  ) {
    return (
      normalizedCurrency(valuation.originalBasis.currency) !== currentCurrency
    );
  }
  return false;
}

function valuationWithoutConflictingCost(
  valuation: InventoryEffectValuation,
): InventoryEffectValuation {
  if (valuation.kind === "inbound") {
    return { ...valuation, costBasis: uncostedBasis() };
  }
  if (valuation.kind === "return") {
    return {
      ...valuation,
      financialContribution: "none",
      originalBasis: {
        allocatedKnownCost: 0,
        basisVersion: valuation.originalBasis.basisVersion,
        costedQuantity: 0,
        currency: null,
        knownCostPoolBefore: 0,
        roundedWeightedAverageUnitCost: null,
        uncostedQuantity:
          valuation.originalBasis.costedQuantity +
          valuation.originalBasis.uncostedQuantity,
        unresolvedDeficitQuantity:
          valuation.originalBasis.unresolvedDeficitQuantity,
      },
    };
  }
  return valuation;
}

function replayValuationInput(valuation: InventoryEffectValuation) {
  switch (valuation.kind) {
    case "availability_only":
      return { kind: "availability_only" as const };
    case "inbound":
      return {
        costBasis: valuation.costBasis,
        kind: "inbound" as const,
        quantity: valuation.quantity,
      };
    case "outbound":
      return {
        disposition: valuation.disposition,
        kind: "outbound" as const,
        quantity: valuation.quantity,
      };
    case "return":
      return {
        disposition: valuation.disposition,
        financialContribution: valuation.financialContribution,
        kind: "return" as const,
        originalBasis: valuation.originalBasis,
        originalCostLane: valuation.originalCostLane,
        quantity: valuation.quantity,
      };
  }
}

function applyValuationTransition(
  position: InventoryValuationPosition,
  args: ApplyInventoryEffectArgs,
  deficitLots: UnresolvedDeficitLot[],
  deferredDeficitQuantity: number,
): ValuationTransition {
  switch (args.valuation.kind) {
    case "availability_only":
      if (args.physicalQuantityDelta !== 0) {
        throw new Error(
          "Availability-only effects cannot change on-hand quantity.",
        );
      }
      return {
        adjustmentInputs: [],
        createdDeficitLot: null,
        deferredDeficitQuantity,
        position: {
          ...position,
          basisVersion: position.basisVersion + 1,
        },
        remainingDeficitLots: deficitLots,
      };

    case "inbound": {
      if (
        args.physicalQuantityDelta !== args.valuation.quantity ||
        args.physicalQuantityDelta <= 0
      ) {
        throw new Error(
          "Inbound valuation quantity must match the positive physical delta.",
        );
      }
      const result = applyInboundValuation(position, {
        costBasis: args.valuation.costBasis,
        deferredDeficitQuantity,
        deficitLots,
        inboundEffectId: args.businessEventKey,
        quantity: args.valuation.quantity,
      });
      return {
        adjustmentInputs: result.valuationAdjustments.map((adjustment) => ({
          businessEventKey: `${args.businessEventKey}:deficit:${adjustment.outboundEffectId}`,
          contentFingerprint: `${args.contentFingerprint}:deficit:${adjustment.outboundEffectId}:${adjustment.knownCost}`,
          costLane: adjustment.costLane,
          currency: adjustment.currency,
          knownCost: adjustment.knownCost,
          outboundEffectId: adjustment.outboundEffectId,
          quantity: adjustment.quantity,
        })),
        createdDeficitLot: null,
        deferredDeficitQuantity: result.deferredDeficitQuantity,
        position: result.position,
        remainingDeficitLots: result.remainingDeficitLots,
      };
    }

    case "outbound": {
      if (
        args.physicalQuantityDelta !== -args.valuation.quantity ||
        args.physicalQuantityDelta >= 0
      ) {
        throw new Error(
          "Outbound valuation quantity must match the negative physical delta.",
        );
      }
      const result = applyOutboundValuation(position, {
        disposition: args.valuation.disposition,
        occurredAt: args.occurrenceAt,
        outboundEffectId: args.businessEventKey,
        quantity: args.valuation.quantity,
      });
      return {
        adjustmentInputs: [],
        createdDeficitLot: result.createdDeficitLot,
        costLane: result.treatment.costLane,
        deferredDeficitQuantity,
        outboundBasisMinor: result.consumed.knownCost,
        position: result.position,
        remainingDeficitLots: deficitLots,
      };
    }

    case "return": {
      const treatmentRestoresStock = args.valuation.disposition === "sellable";
      const expectedPhysicalDelta = treatmentRestoresStock
        ? args.valuation.quantity
        : 0;
      if (args.physicalQuantityDelta !== expectedPhysicalDelta) {
        throw new Error(
          "Return physical delta must match its inventory disposition.",
        );
      }
      const result = applyReturnValuation(position, {
        deferredDeficitQuantity,
        deficitLots,
        disposition: args.valuation.disposition,
        occurredAt: args.occurrenceAt,
        originalBasis: args.valuation.originalBasis,
        quantity: args.valuation.quantity,
        returnEffectId: args.businessEventKey,
      });
      return {
        adjustmentInputs: result.valuationAdjustments.map((adjustment) => ({
          businessEventKey: `${args.businessEventKey}:deficit:${adjustment.outboundEffectId}`,
          contentFingerprint: `${args.contentFingerprint}:deficit:${adjustment.outboundEffectId}:${adjustment.knownCost}`,
          costLane: adjustment.costLane,
          currency: adjustment.currency,
          knownCost: adjustment.knownCost,
          outboundEffectId: adjustment.outboundEffectId,
          quantity: adjustment.quantity,
        })),
        createdDeficitLot: null,
        cogsReversalKnownMinor: result.cogsReversalKnownCost,
        costLane: args.valuation.originalCostLane,
        deferredDeficitQuantity: result.deferredDeficitQuantity,
        position: result.position,
        remainingDeficitLots: result.remainingDeficitLots,
      };
    }
  }
}

function applyLateValuationTransition(
  position: InventoryValuationPosition,
  args: ApplyInventoryEffectArgs,
  deficitLots: UnresolvedDeficitLot[],
  deferredDeficitQuantity: number,
): ValuationTransition {
  switch (args.valuation.kind) {
    case "availability_only":
      return {
        adjustmentInputs: [],
        createdDeficitLot: null,
        deferredDeficitQuantity,
        position: { ...position, basisVersion: position.basisVersion + 1 },
        remainingDeficitLots: deficitLots,
      };
    case "inbound": {
      const result = applyInboundValuation(position, {
        costBasis: uncostedBasis(),
        deferredDeficitQuantity,
        deficitLots,
        inboundEffectId: args.businessEventKey,
        quantity: args.valuation.quantity,
      });
      return {
        adjustmentInputs: [],
        createdDeficitLot: null,
        deferredDeficitQuantity: result.deferredDeficitQuantity,
        position: result.position,
        remainingDeficitLots: result.remainingDeficitLots,
      };
    }
    case "return": {
      if (args.valuation.disposition !== "sellable") {
        return {
          adjustmentInputs: [],
          createdDeficitLot: null,
          costLane: args.valuation.originalCostLane,
          deferredDeficitQuantity,
          position: { ...position, basisVersion: position.basisVersion + 1 },
          remainingDeficitLots: deficitLots,
        };
      }
      const result = applyInboundValuation(position, {
        costBasis: uncostedBasis(),
        deferredDeficitQuantity,
        deficitLots,
        inboundEffectId: args.businessEventKey,
        quantity: args.valuation.quantity,
      });
      return {
        adjustmentInputs: [],
        createdDeficitLot: null,
        costLane: args.valuation.originalCostLane,
        deferredDeficitQuantity: result.deferredDeficitQuantity,
        position: result.position,
        remainingDeficitLots: result.remainingDeficitLots,
      };
    }
    case "outbound": {
      const unknownPosition: InventoryValuationPosition = {
        basisVersion: position.basisVersion,
        costedQuantity: 0,
        currency: null,
        knownCostPool: 0,
        uncostedQuantity: onHandQuantity(position),
        unresolvedDeficitQuantity: position.unresolvedDeficitQuantity,
      };
      const result = applyOutboundValuation(unknownPosition, {
        disposition: args.valuation.disposition,
        occurredAt: args.occurrenceAt,
        outboundEffectId: args.businessEventKey,
        quantity: args.valuation.quantity,
      });
      return {
        adjustmentInputs: [],
        createdDeficitLot: result.createdDeficitLot,
        costLane: result.treatment.costLane,
        deferredDeficitQuantity,
        position: result.position,
        remainingDeficitLots: deficitLots,
      };
    }
  }
}

async function readSinglePosition(
  ctx: MutationCtx,
  args: Pick<ApplyInventoryEffectArgs, "productSkuId" | "storeId">,
) {
  const rows = await ctx.db
    .query("reportingInventoryPosition")
    .withIndex("by_storeId_productSkuId", (query) =>
      query.eq("storeId", args.storeId).eq("productSkuId", args.productSkuId),
    )
    .take(2);
  if (rows.length > 1) {
    throw new Error("SKU has multiple reporting inventory positions.");
  }
  return rows[0] ?? null;
}

async function inventoryAuthorityMode(
  ctx: MutationCtx,
  storeId: Id<"store">,
): Promise<"authoritative" | "compatibility_shadow"> {
  const activation = await ctx.db
    .query("reportingProjectionActivation")
    .withIndex("by_storeId_projectionKind_activatedAt", (query) =>
      query.eq("storeId", storeId).eq("projectionKind", "current_inventory"),
    )
    .order("desc")
    .first();
  if (!activation || activation.supersededAt !== undefined) {
    return "compatibility_shadow";
  }
  const generation = await ctx.db.get(
    "reportingProjectionGeneration",
    activation.generationId,
  );
  return generation &&
    generation.storeId === storeId &&
    generation.projectionKind === "current_inventory" &&
    generation.status === "active"
    ? "authoritative"
    : "compatibility_shadow";
}

async function readOpenDeficitLots(
  ctx: MutationCtx,
  position: Doc<"reportingInventoryPosition"> | null,
  requestedResolutionQuantity: number,
) {
  if (!position || requestedResolutionQuantity <= 0) {
    return {
      deferredDeficitQuantity: position?.unresolvedDeficitQuantity ?? 0,
      lots: [] as Array<Doc<"reportingInventoryDeficitLot">>,
      requiresContinuation: false,
    };
  }
  const maximumResolvedQuantity = Math.min(
    position.unresolvedDeficitQuantity,
    requestedResolutionQuantity,
  );
  if (maximumResolvedQuantity === 0) {
    return {
      deferredDeficitQuantity: 0,
      lots: [],
      requiresContinuation: false,
    };
  }
  const synchronousLotLimit = 20;
  const takeLimit = Math.min(maximumResolvedQuantity, synchronousLotLimit);
  const lots = position.deficitLedgerId
    ? await ctx.db
        .query("reportingInventoryDeficitLot")
        .withIndex("by_ledgerId_status_occurredAt_outboundEffectId", (query) =>
          query.eq("ledgerId", position.deficitLedgerId).eq("status", "open"),
        )
        .take(takeLimit)
    : await ctx.db
        .query("reportingInventoryDeficitLot")
        .withIndex(
          "by_positionId_status_occurredAt_outboundEffectId",
          (query) => query.eq("positionId", position._id).eq("status", "open"),
        )
        .take(takeLimit);
  if (
    lots.some(
      (lot) =>
        lot.organizationId !== position.organizationId ||
        lot.storeId !== position.storeId ||
        lot.productSkuId !== position.productSkuId,
    )
  ) {
    throw new Error(
      "Reporting inventory deficit lot ownership does not match its position.",
    );
  }
  if (new Set(lots.map((lot) => lot.outboundEffectId)).size !== lots.length) {
    throw new Error(
      "Reporting inventory deficit effect has duplicate open lots.",
    );
  }
  const total = lots.reduce((sum, lot) => sum + lot.remainingQuantity, 0);
  if (total > position.unresolvedDeficitQuantity) {
    throw new Error(
      "Reporting inventory deficit lots do not reconcile to the position.",
    );
  }
  if (total < maximumResolvedQuantity) {
    if (lots.length < takeLimit) {
      throw new Error(
        "Bounded FIFO prefix does not cover the quantity resolving deficit.",
      );
    }
    return {
      deferredDeficitQuantity: position.unresolvedDeficitQuantity,
      lots,
      requiresContinuation: true,
    };
  }
  return {
    deferredDeficitQuantity: position.unresolvedDeficitQuantity - total,
    lots,
    requiresContinuation: false,
  };
}

function applyDeferredDeficitTransition(
  position: InventoryValuationPosition,
  args: ApplyInventoryEffectArgs,
): ValuationTransition {
  const quantity =
    args.valuation.kind === "inbound" || args.valuation.kind === "return"
      ? args.valuation.quantity
      : 0;
  const resolvedQuantity = Math.min(
    position.unresolvedDeficitQuantity,
    quantity,
  );
  const residualQuantity = quantity - resolvedQuantity;
  return {
    adjustmentInputs: [],
    createdDeficitLot: null,
    deferredDeficitQuantity:
      position.unresolvedDeficitQuantity - resolvedQuantity,
    position: {
      ...position,
      basisVersion: position.basisVersion + 1,
      uncostedQuantity: position.uncostedQuantity + residualQuantity,
      unresolvedDeficitQuantity:
        position.unresolvedDeficitQuantity - resolvedQuantity,
    },
    remainingDeficitLots: [],
  };
}

function requestedDeficitResolutionQuantity(args: ApplyInventoryEffectArgs) {
  if (args.valuation.kind === "inbound") return args.valuation.quantity;
  if (
    args.valuation.kind === "return" &&
    args.valuation.disposition === "sellable"
  ) {
    return args.valuation.quantity;
  }
  return 0;
}

function assertDeficitTransitionReconciles(transition: ValuationTransition) {
  const selectedRemainingQuantity = transition.remainingDeficitLots.reduce(
    (sum, lot) => sum + lot.remainingQuantity,
    0,
  );
  const createdQuantity = transition.createdDeficitLot?.remainingQuantity ?? 0;
  if (
    selectedRemainingQuantity +
      transition.deferredDeficitQuantity +
      createdQuantity !==
    transition.position.unresolvedDeficitQuantity
  ) {
    throw new Error("Deficit transition does not reconcile to its position.");
  }
}

function valuationLotsFromDocuments(
  lots: Array<Doc<"reportingInventoryDeficitLot">>,
): UnresolvedDeficitLot[] {
  return lots.map((lot) => ({
    costLane: lot.costLane,
    occurredAt: lot.occurredAt,
    outboundEffectId: lot.outboundEffectId,
    remainingQuantity: lot.remainingQuantity,
  }));
}

async function persistDeficitLotTransition(
  ctx: MutationCtx,
  args: {
    createdDeficitLot: UnresolvedDeficitLot | null;
    effectId: Id<"reportingInventoryEffect">;
    existingLots: Array<Doc<"reportingInventoryDeficitLot">>;
    organizationId: Id<"organization">;
    positionId: Id<"reportingInventoryPosition">;
    ledgerId: Id<"reportingInventoryDeficitLedger">;
    productSkuId: Id<"productSku">;
    recordedAt: number;
    remainingDeficitLots: UnresolvedDeficitLot[];
    storeId: Id<"store">;
  },
): Promise<void> {
  const remainingByEffect = new Map(
    args.remainingDeficitLots.map((lot) => [
      lot.outboundEffectId,
      lot.remainingQuantity,
    ]),
  );

  for (const lot of args.existingLots) {
    const remainingQuantity = remainingByEffect.get(lot.outboundEffectId) ?? 0;
    if (remainingQuantity === lot.remainingQuantity) continue;
    await ctx.db.patch("reportingInventoryDeficitLot", lot._id, {
      remainingQuantity,
      status: remainingQuantity > 0 ? "open" : "resolved",
      updatedAt: args.recordedAt,
      ...(remainingQuantity === 0 ? { resolvedAt: args.recordedAt } : {}),
    });
  }

  if (args.createdDeficitLot) {
    await ctx.db.insert("reportingInventoryDeficitLot", {
      organizationId: args.organizationId,
      storeId: args.storeId,
      positionId: args.positionId,
      ledgerId: args.ledgerId,
      productSkuId: args.productSkuId,
      outboundEffectId: args.effectId,
      costLane: args.createdDeficitLot.costLane,
      occurredAt: args.createdDeficitLot.occurredAt,
      remainingQuantity: args.createdDeficitLot.remainingQuantity,
      status: "open",
      createdAt: args.recordedAt,
      updatedAt: args.recordedAt,
    });
  }
}

async function readExistingEffect(
  ctx: MutationCtx,
  args: Pick<
    ApplyInventoryEffectArgs,
    "businessEventKey" | "sourceDomain" | "storeId"
  >,
) {
  const rows = await ctx.db
    .query("reportingInventoryEffect")
    .withIndex("by_storeId_sourceDomain_businessEventKey", (query) =>
      query
        .eq("storeId", args.storeId)
        .eq("sourceDomain", args.sourceDomain)
        .eq("businessEventKey", args.businessEventKey),
    )
    .take(2);
  if (rows.length > 1) {
    throw new Error("Business event key has duplicate inventory effects.");
  }
  return rows[0] ?? null;
}

function validateArgs(args: ApplyInventoryEffectArgs): void {
  assertNonempty(args.activityType, "Inventory activity type");
  assertNonempty(args.businessEventKey, "Inventory business event key");
  assertNonempty(args.contentFingerprint, "Inventory content fingerprint");
  assertNonempty(args.movementType, "Inventory movement type");
  if (args.operatingDate !== undefined) {
    assertNonempty(args.operatingDate, "Inventory operating date");
  }
  if (
    (args.operatingDate === undefined) !==
    (args.scheduleVersionId === undefined)
  ) {
    throw new Error(
      "Inventory operating date and schedule version must be provided together.",
    );
  }
  assertNonempty(args.sourceId, "Inventory source id");
  assertNonempty(args.sourceType, "Inventory source type");
  assertInteger(args.physicalQuantityDelta, "Physical quantity delta");
  assertInteger(args.sellableQuantityDelta, "Sellable quantity delta");
  assertInteger(args.occurrenceAt, "Inventory occurrence time");
  if (args.recordedAt !== undefined) {
    assertInteger(args.recordedAt, "Inventory recorded time");
  }
  if (args.currencyMinorUnitScale !== undefined) {
    assertInteger(args.currencyMinorUnitScale, "Currency minor-unit scale");
  }
}

async function insertSourceReference(
  ctx: MutationCtx,
  args: {
    createdAt: number;
    effectId: Id<"reportingInventoryEffect">;
    relation: string;
    sourceId: string;
    sourceType: string;
    storeId: Id<"store">;
  },
) {
  await ctx.db.insert("reportingInventoryEffectSourceReference", args);
}

async function materializeInventoryFinancialFactWithCtx(
  ctx: MutationCtx,
  input: {
    args: ApplyInventoryEffectArgs;
    effect: Doc<"reportingInventoryEffect">;
    recordedAt: number;
  },
) {
  if (!input.effect.operatingDate || !input.effect.scheduleVersionId)
    return null;

  const valuation = input.args.valuation;
  const contributionKind =
    valuation.kind === "return" &&
    valuation.disposition === "sellable" &&
    valuation.financialContribution === "reverse_original_lane" &&
    (valuation.originalCostLane === "merchandise_cogs" ||
      valuation.originalCostLane === "exchange_merchandise_cogs")
      ? ("sellable_return_cogs_reversal" as const)
      : valuation.kind === "return" &&
          valuation.disposition === "sellable" &&
          valuation.financialContribution === "reverse_original_lane" &&
          valuation.originalCostLane === "inventory_consumed"
        ? ("inventory_consumed_reversal" as const)
        : valuation.kind === "outbound" &&
            input.effect.costLane === "exchange_merchandise_cogs"
          ? ("exchange_replacement_cogs" as const)
          : valuation.kind === "outbound" &&
              input.effect.costLane === "inventory_consumed"
            ? ("inventory_consumed" as const)
            : null;
  if (!contributionKind) return null;

  const quantity =
    valuation.kind === "return" || valuation.kind === "outbound"
      ? valuation.quantity
      : 0;
  const costedQuantity =
    valuation.kind === "return"
      ? Math.max(
          0,
          quantity -
            Math.min(valuation.originalBasis.uncostedQuantity, quantity),
        )
      : Math.max(0, -input.effect.costedQuantityDelta);
  const uncostedQuantity =
    valuation.kind === "return"
      ? Math.min(valuation.originalBasis.uncostedQuantity, quantity)
      : Math.max(0, -input.effect.uncostedQuantityDelta) +
        Math.max(0, input.effect.unresolvedDeficitDelta);
  const knownCost =
    contributionKind === "sellable_return_cogs_reversal" ||
    contributionKind === "inventory_consumed_reversal"
      ? input.effect.cogsReversalKnownMinor
      : input.effect.outboundBasisMinor;
  const hasKnownCost =
    costedQuantity > 0 &&
    knownCost !== undefined &&
    input.effect.currencyCode !== undefined;
  const costStatus = hasKnownCost
    ? uncostedQuantity > 0
      ? ("partial" as const)
      : ("known" as const)
    : ("unknown" as const);
  const businessEventKey = `${input.effect.businessEventKey}:financial_contribution`;
  const existing = await ctx.db
    .query("reportingFact")
    .withIndex("by_storeId_sourceDomain_businessEventKey", (q) =>
      q
        .eq("storeId", input.effect.storeId)
        .eq("sourceDomain", "inventory")
        .eq("businessEventKey", businessEventKey),
    )
    .first();
  if (existing) return existing._id;

  const factId = await ctx.db.insert("reportingFact", {
    acceptedAt: input.recordedAt,
    amountMinor: 0,
    businessEventKey,
    ...(hasKnownCost
      ? {
          cogsKnownMinor:
            contributionKind === "sellable_return_cogs_reversal" ||
            contributionKind === "inventory_consumed_reversal"
              ? -Math.abs(knownCost)
              : Math.abs(knownCost),
          valuationCurrencyCode: input.effect.currencyCode,
          valuationCurrencyMinorUnitScale:
            input.effect.currencyMinorUnitScale ?? 2,
        }
      : {}),
    completeness:
      costStatus === "known" ? input.effect.completeness : "partial",
    contentFingerprint: `inventory-financial-contribution:v1:${input.effect._id}:${contributionKind}:${quantity}:${knownCost ?? "unknown"}`,
    costStatus,
    createdAt: input.recordedAt,
    factContractVersion: 1,
    factType:
      contributionKind === "sellable_return_cogs_reversal"
        ? "return"
        : "inventory_issue",
    inventoryContributionKind: contributionKind,
    inventoryEffectId: input.effect._id,
    limitingReason: costStatus === "known" ? undefined : "uncosted",
    metricContractVersion: 1,
    occurrenceAt: input.effect.occurrenceAt,
    operatingDate: input.effect.operatingDate,
    organizationId: input.effect.organizationId,
    productSkuId: input.effect.productSkuId,
    quantity:
      contributionKind === "sellable_return_cogs_reversal"
        ? -Math.abs(quantity)
        : contributionKind === "inventory_consumed_reversal"
          ? -Math.abs(quantity)
          : Math.abs(quantity),
    recognitionAt: input.effect.occurrenceAt,
    scheduleVersionId: input.effect.scheduleVersionId,
    sourceDomain: "inventory",
    status: "canonical",
    storeId: input.effect.storeId,
  });
  await ctx.db.insert("reportingFactSourceReference", {
    createdAt: input.recordedAt,
    factId,
    relation: "owns",
    sourceId: String(input.effect._id),
    sourceType: "reporting_inventory_effect",
    storeId: input.effect.storeId,
  });
  const fact = await ctx.db.get("reportingFact", factId);
  if (!fact)
    throw new Error("Inventory financial contribution was not persisted.");
  await recordFactSkuEvidenceWithCtx(ctx, fact);
  await scheduleFactProjectionBatchWithCtx(ctx, [factId]);
  return factId;
}

async function recordLateEffectEvidence(
  ctx: MutationCtx,
  input: {
    effectId: Id<"reportingInventoryEffect">;
    lastEffectAt: number;
    occurrenceAt: number;
    organizationId: Id<"organization">;
    productSkuId: Id<"productSku">;
    recordedAt: number;
    sourceDomain: ReportingSourceDomain;
    storeId: Id<"store">;
  },
) {
  const reconciliationKey = `late_inventory_effect:${input.effectId}`;
  const quarantine = await ctx.db
    .query("reportingQuarantine")
    .withIndex("by_inventoryEffectId", (query) =>
      query.eq("inventoryEffectId", input.effectId),
    )
    .first();
  if (!quarantine) {
    await ctx.db.insert("reportingQuarantine", {
      detectedAt: input.recordedAt,
      inventoryEffectId: input.effectId,
      organizationId: input.organizationId,
      safeCode: "late_inventory_occurrence",
      safeFingerprint: reconciliationKey,
      sourceDomain: input.sourceDomain,
      status: "open",
      storeId: input.storeId,
    });
  }
  const discrepancy = await ctx.db
    .query("reportingReconciliationDiscrepancy")
    .withIndex("by_reconciliationKey", (query) =>
      query.eq("reconciliationKey", reconciliationKey),
    )
    .first();
  if (!discrepancy) {
    await ctx.db.insert("reportingReconciliationDiscrepancy", {
      actualMinorOrQuantity: input.occurrenceAt,
      detectedAt: input.recordedAt,
      expectedMinorOrQuantity: input.lastEffectAt,
      explainedDifference: 0,
      invariant: "inventory_effect_occurrence_order",
      organizationId: input.organizationId,
      productSkuId: input.productSkuId,
      reconciliationKey,
      status: "open",
      storeId: input.storeId,
      unexplainedDifference: input.occurrenceAt - input.lastEffectAt,
    });
  }
}

async function recordValuationCurrencyConflict(
  ctx: MutationCtx,
  input: {
    effectId: Id<"reportingInventoryEffect">;
    existingCurrency: string;
    organizationId: Id<"organization">;
    recordedAt: number;
    sourceCurrency: string;
    sourceDomain: ReportingSourceDomain;
    storeId: Id<"store">;
  },
) {
  const existing = await ctx.db
    .query("reportingQuarantine")
    .withIndex("by_inventoryEffectId", (query) =>
      query.eq("inventoryEffectId", input.effectId),
    )
    .first();
  if (existing) return;
  await ctx.db.insert("reportingQuarantine", {
    detectedAt: input.recordedAt,
    inventoryEffectId: input.effectId,
    organizationId: input.organizationId,
    safeCode: "valuation_currency_conflict",
    safeFingerprint: [
      "valuation-currency-conflict-v1",
      input.effectId,
      input.existingCurrency,
      input.sourceCurrency,
    ].join(":"),
    sourceDomain: input.sourceDomain,
    status: "open",
    storeId: input.storeId,
  });
}

async function invalidateCurrentInventoryForConflict(
  ctx: MutationCtx,
  input: {
    detectedAt: number;
    effect: Doc<"reportingInventoryEffect">;
    quarantinedCount: number;
  },
) {
  const activation = await ctx.db
    .query("reportingProjectionActivation")
    .withIndex("by_storeId_projectionKind_activatedAt", (query) =>
      query
        .eq("storeId", input.effect.storeId)
        .eq("projectionKind", "current_inventory"),
    )
    .order("desc")
    .first();
  const generation = activation
    ? await ctx.db.get("reportingProjectionGeneration", activation.generationId)
    : null;
  const activeGeneration =
    activation &&
    activation.supersededAt === undefined &&
    generation?.status === "active" &&
    generation.projectionKind === "current_inventory"
      ? generation
      : null;
  if (activeGeneration) {
    await materializeGenerationCoverageWithCtx(ctx, {
      defaultCompleteness: "partial",
      generation: activeGeneration,
      globalLimitingReason: "duplicate_conflict",
      periodEnd: input.effect.occurrenceAt,
      periodStart: input.effect.occurrenceAt,
      quarantinedSources: { inventory: 1 },
    });
  }
  await upsertProjectionHealthWithCtx(ctx, {
    activeGenerationId: activeGeneration?._id,
    factContractVersion:
      activeGeneration?.factContractVersion ?? REPORTING_FACT_CONTRACT_VERSION,
    limitingReason: "duplicate_conflict",
    metricContractVersion: activeGeneration?.metricContractVersion ?? 1,
    organizationId: input.effect.organizationId,
    processingWatermark: input.effect._creationTime,
    projectionContractVersion:
      activeGeneration?.projectionContractVersion ??
      REPORTING_PROJECTION_CONTRACT_VERSION,
    projectionKind: "current_inventory",
    quarantinedCount: Math.max(1, input.quarantinedCount),
    sourceDomain: "inventory",
    storeId: input.effect.storeId,
    updatedAt: input.detectedAt,
  });
}

export async function applyInventoryEffectWithCtx(
  ctx: MutationCtx,
  args: ApplyInventoryEffectArgs,
): Promise<InventoryEffectResult> {
  validateArgs(args);
  const existingEffect = await readExistingEffect(ctx, args);
  if (existingEffect) {
    if (existingEffect.contentFingerprint !== args.contentFingerprint) {
      const detectedAt = Date.now();
      const safeFingerprint = [
        "inventory-effect-duplicate-conflict-v1",
        args.storeId,
        args.businessEventKey,
        existingEffect.contentFingerprint,
        args.contentFingerprint,
      ].join(":");
      const priorQuarantines = await ctx.db
        .query("reportingQuarantine")
        .withIndex("by_inventoryEffectId", (query) =>
          query.eq("inventoryEffectId", existingEffect._id),
        )
        .take(20);
      if (
        !priorQuarantines.some(
          (row) =>
            row.status === "open" && row.safeFingerprint === safeFingerprint,
        )
      ) {
        await ctx.db.insert("reportingQuarantine", {
          detectedAt,
          inventoryEffectId: existingEffect._id,
          organizationId: existingEffect.organizationId,
          safeCode: "inventory_effect_duplicate_conflict",
          safeFingerprint,
          sourceDomain: existingEffect.sourceDomain,
          status: "open",
          storeId: existingEffect.storeId,
        });
      }
      await invalidateCurrentInventoryForConflict(ctx, {
        detectedAt,
        effect: existingEffect,
        quarantinedCount:
          priorQuarantines.filter((row) => row.status === "open").length + 1,
      });
      const conflictPosition = existingEffect.positionId
        ? await ctx.db.get(
            "reportingInventoryPosition",
            existingEffect.positionId,
          )
        : await readSinglePosition(ctx, args);
      if (!conflictPosition) {
        throw new Error(
          "Conflicting inventory effect is missing its position.",
        );
      }
      return {
        adjustmentEffects: [],
        disposition: "conflict",
        effect: existingEffect,
        mode: conflictPosition.mode,
        movement: null,
        position: conflictPosition,
      };
    }
    const existingPosition = existingEffect.positionId
      ? await ctx.db.get(
          "reportingInventoryPosition",
          existingEffect.positionId,
        )
      : await readSinglePosition(ctx, args);
    if (!existingPosition) {
      throw new Error("Existing inventory effect is missing its position.");
    }
    return {
      adjustmentEffects: [],
      disposition: "existing",
      effect: existingEffect,
      mode: existingPosition.mode,
      movement: null,
      position: existingPosition,
    };
  }

  const productSku = await ctx.db.get("productSku", args.productSkuId);
  if (
    !productSku ||
    productSku.storeId !== args.storeId ||
    productSku.productId !== args.productId
  ) {
    throw new Error("Selected SKU could not be found for this store.");
  }

  const existingPosition = await readSinglePosition(ctx, args);
  if (
    existingPosition &&
    (existingPosition.organizationId !== args.organizationId ||
      existingPosition.onHandQuantity !== productSku.inventoryCount ||
      existingPosition.sellableQuantity !== productSku.quantityAvailable)
  ) {
    throw new Error(
      "Reporting inventory position does not reconcile to operational inventory.",
    );
  }

  const beforeValuation = existingPosition
    ? positionToValuation(existingPosition)
    : shadowValuationFromSku(productSku);
  const currencyConflict = hasValuationCurrencyConflict(
    beforeValuation,
    args.valuation,
  );
  const transitionArgs = currencyConflict
    ? { ...args, valuation: valuationWithoutConflictingCost(args.valuation) }
    : args;
  const lateEffect =
    existingPosition !== undefined &&
    existingPosition !== null &&
    args.occurrenceAt < existingPosition.lastEffectAt;
  const valuationRequiresRebuild =
    lateEffect ||
    currencyConflict ||
    existingPosition?.valuationStatus === "rebuild_required";
  const mode = await inventoryAuthorityMode(ctx, args.storeId);
  const deficitLotRead = await readOpenDeficitLots(
    ctx,
    existingPosition,
    requestedDeficitResolutionQuantity(transitionArgs),
  );
  const existingDeficitLots = deficitLotRead.lots;
  const requiresDeficitContinuation = deficitLotRead.requiresContinuation;
  const transition = requiresDeficitContinuation
    ? applyDeferredDeficitTransition(beforeValuation, transitionArgs)
    : lateEffect
      ? applyLateValuationTransition(
          beforeValuation,
          transitionArgs,
          valuationLotsFromDocuments(existingDeficitLots),
          deficitLotRead.deferredDeficitQuantity,
        )
      : applyValuationTransition(
          beforeValuation,
          transitionArgs,
          valuationLotsFromDocuments(existingDeficitLots),
          deficitLotRead.deferredDeficitQuantity,
        );
  if (!requiresDeficitContinuation) {
    assertDeficitTransitionReconciles(transition);
  }
  const hasScheduleAttribution =
    args.operatingDate !== undefined && args.scheduleVersionId !== undefined;
  const effectCompleteness: ReportingCompleteness =
    valuationRequiresRebuild || requiresDeficitContinuation
      ? "partial"
      : !hasScheduleAttribution
        ? "partial"
        : mode === "compatibility_shadow"
          ? "provisional"
          : args.completeness;
  const suppressReturnFinancialContribution =
    args.valuation.kind === "return" &&
    args.valuation.financialContribution === "none";
  const computedOnHand = onHandQuantity(transition.position);
  const defaultSellable = Math.min(
    computedOnHand,
    Math.max(0, productSku.quantityAvailable + args.sellableQuantityDelta),
  );
  const nextOnHand =
    mode === "compatibility_shadow" && args.compatibilityBalance
      ? args.compatibilityBalance.onHandQuantity
      : computedOnHand;
  const nextSellable =
    mode === "compatibility_shadow" && args.compatibilityBalance
      ? args.compatibilityBalance.sellableQuantity
      : defaultSellable;
  assertInteger(nextOnHand, "Resulting on-hand quantity");
  assertInteger(nextSellable, "Resulting sellable quantity");
  if (nextOnHand < 0 || nextSellable < 0) {
    throw new Error("Operational inventory balances cannot be negative.");
  }
  if (nextSellable > nextOnHand) {
    throw new Error("Sellable inventory cannot exceed on-hand inventory.");
  }

  const recordedAt = args.recordedAt ?? Date.now();
  const committedAt = Date.now();
  const positionValue = {
    organizationId: args.organizationId,
    storeId: args.storeId,
    productSkuId: args.productSkuId,
    mode,
    onHandQuantity: nextOnHand,
    sellableQuantity: nextSellable,
    costedQuantity: transition.position.costedQuantity,
    uncostedQuantity: transition.position.uncostedQuantity,
    unresolvedDeficitQuantity: transition.position.unresolvedDeficitQuantity,
    knownCostPoolMinor: transition.position.knownCostPool,
    ...(transition.position.currency
      ? { currencyCode: transition.position.currency }
      : {}),
    ...(transition.position.currency &&
    (transition.position.currency === beforeValuation.currency
      ? existingPosition?.currencyMinorUnitScale
      : args.currencyMinorUnitScale) !== undefined
      ? {
          currencyMinorUnitScale:
            transition.position.currency === beforeValuation.currency
              ? existingPosition?.currencyMinorUnitScale
              : args.currencyMinorUnitScale,
        }
      : {}),
    lastEffectAt: Math.max(
      existingPosition?.lastEffectAt ?? args.occurrenceAt,
      args.occurrenceAt,
    ),
    valuationPendingFrom:
      valuationRequiresRebuild || requiresDeficitContinuation
        ? Math.min(
            existingPosition?.valuationPendingFrom ?? args.occurrenceAt,
            args.occurrenceAt,
          )
        : undefined,
    valuationStatus:
      valuationRequiresRebuild || requiresDeficitContinuation
        ? ("rebuild_required" as const)
        : ("current" as const),
    version: transition.position.basisVersion,
    updatedAt: committedAt,
  };
  let positionId: Id<"reportingInventoryPosition">;
  if (existingPosition) {
    positionId = existingPosition._id;
    await ctx.db.patch("reportingInventoryPosition", positionId, {
      ...positionValue,
      ...(transition.position.currency === null
        ? {
            currencyCode: undefined,
            currencyMinorUnitScale: undefined,
          }
        : {}),
    });
  } else {
    positionId = await ctx.db.insert(
      "reportingInventoryPosition",
      positionValue,
    );
  }
  const positionForLedger = await ctx.db.get(
    "reportingInventoryPosition",
    positionId,
  );
  if (!positionForLedger) throw new Error("Inventory position disappeared");
  const deficitLedgerId = await ensureActiveDeficitLedgerWithCtx(ctx, {
    position: positionForLedger,
    recordedAt: committedAt,
  });

  const sourceValuationCurrency =
    args.valuation.kind === "inbound" &&
    args.valuation.costBasis.kind === "known"
      ? args.valuation.costBasis.currency
      : args.valuation.kind === "return" &&
          args.valuation.originalBasis.costedQuantity > 0
        ? args.valuation.originalBasis.currency
        : undefined;
  const effectCurrency =
    sourceValuationCurrency ??
    (args.valuation.kind === "outbound"
      ? beforeValuation.currency
      : args.valuation.kind === "availability_only" && !lateEffect
        ? transition.position.currency
        : undefined);
  const effectId = await ctx.db.insert("reportingInventoryEffect", {
    organizationId: args.organizationId,
    storeId: args.storeId,
    productSkuId: args.productSkuId,
    positionId,
    sourceDomain: args.sourceDomain,
    businessEventKey: args.businessEventKey,
    effectType: args.effectType,
    occurrenceAt: args.occurrenceAt,
    ...(args.operatingDate !== undefined
      ? { operatingDate: args.operatingDate }
      : {}),
    ...(args.scheduleVersionId !== undefined
      ? { scheduleVersionId: args.scheduleVersionId }
      : {}),
    physicalQuantityDelta: args.physicalQuantityDelta,
    sellableQuantityDelta: args.sellableQuantityDelta,
    ...(args.valuation.kind === "return"
      ? {
          returnedQuantity: args.valuation.quantity,
          returnDisposition: args.valuation.disposition,
        }
      : {}),
    replayValuation: replayValuationInput(args.valuation),
    knownCostPoolDeltaMinor:
      transition.position.knownCostPool - beforeValuation.knownCostPool,
    ...(!valuationRequiresRebuild &&
    !requiresDeficitContinuation &&
    transition.outboundBasisMinor !== undefined
      ? { outboundBasisMinor: transition.outboundBasisMinor }
      : {}),
    ...(!valuationRequiresRebuild &&
    !requiresDeficitContinuation &&
    transition.costLane
      ? { costLane: transition.costLane }
      : {}),
    ...(!valuationRequiresRebuild &&
    !requiresDeficitContinuation &&
    !suppressReturnFinancialContribution &&
    transition.cogsReversalKnownMinor !== undefined
      ? { cogsReversalKnownMinor: transition.cogsReversalKnownMinor }
      : {}),
    costedQuantityDelta:
      transition.position.costedQuantity - beforeValuation.costedQuantity,
    uncostedQuantityDelta:
      transition.position.uncostedQuantity - beforeValuation.uncostedQuantity,
    unresolvedDeficitDelta:
      transition.position.unresolvedDeficitQuantity -
      beforeValuation.unresolvedDeficitQuantity,
    ...(effectCurrency ? { currencyCode: effectCurrency } : {}),
    ...(effectCurrency && args.currencyMinorUnitScale !== undefined
      ? { currencyMinorUnitScale: args.currencyMinorUnitScale }
      : {}),
    contentFingerprint: args.contentFingerprint,
    completeness: effectCompleteness,
    valuationStatus:
      valuationRequiresRebuild || requiresDeficitContinuation
        ? "rebuild_required"
        : "current",
    createdAt: recordedAt,
  });
  const effect = await ctx.db.get("reportingInventoryEffect", effectId);
  if (!effect) throw new Error("Inventory effect could not be recorded.");
  await recordInventoryPositionRevisionWithCtx(ctx, {
    effectId,
    organizationId: args.organizationId,
    positionId,
    productSkuId: args.productSkuId,
    recordedAt: committedAt,
    revisionKind: "effect_applied",
    storeId: args.storeId,
  });
  if (requiresDeficitContinuation && existingPosition) {
    const resolutionQuantity = Math.min(
      existingPosition.unresolvedDeficitQuantity,
      requestedDeficitResolutionQuantity(transitionArgs),
    );
    const costInput =
      transitionArgs.valuation.kind === "inbound" &&
      transitionArgs.valuation.costBasis.kind === "known"
        ? {
            currencyCode: transitionArgs.valuation.costBasis.currency,
            totalReceiptCostMinor: transitionArgs.valuation.costBasis.totalCost,
          }
        : transitionArgs.valuation.kind === "return" &&
            transitionArgs.valuation.originalBasis.costedQuantity > 0 &&
            transitionArgs.valuation.originalBasis.currency
          ? {
              currencyCode: transitionArgs.valuation.originalBasis.currency,
              totalReceiptCostMinor:
                transitionArgs.valuation.originalBasis.allocatedKnownCost,
            }
          : {};
    await enqueueDeficitResolutionWorkWithCtx(ctx, {
      ...costInput,
      currencyMinorUnitScale: args.currencyMinorUnitScale,
      inboundEffectId: effectId,
      ledgerId: deficitLedgerId,
      occurrenceAt: args.occurrenceAt,
      operatingDate: args.operatingDate,
      organizationId: args.organizationId,
      positionId,
      productSkuId: args.productSkuId,
      resolutionQuantity,
      scheduleVersionId: args.scheduleVersionId,
      storeId: args.storeId,
      totalReceiptQuantity:
        transitionArgs.valuation.kind === "inbound" ||
        transitionArgs.valuation.kind === "return"
          ? transitionArgs.valuation.quantity
          : resolutionQuantity,
    });
  }

  await insertSourceReference(ctx, {
    createdAt: recordedAt,
    effectId,
    relation: "owns",
    sourceId: args.sourceLineId ?? args.sourceId,
    sourceType: args.sourceType,
    storeId: args.storeId,
  });
  await recordInventoryEffectSkuEvidenceWithCtx(ctx, effect);
  if (effect.valuationStatus !== "rebuild_required") {
    await materializeInventoryFinancialFactWithCtx(ctx, {
      args,
      effect,
      recordedAt,
    });
  }

  if (lateEffect && existingPosition) {
    await recordLateEffectEvidence(ctx, {
      effectId,
      lastEffectAt: existingPosition.lastEffectAt,
      occurrenceAt: args.occurrenceAt,
      organizationId: args.organizationId,
      productSkuId: args.productSkuId,
      recordedAt,
      sourceDomain: args.sourceDomain,
      storeId: args.storeId,
    });
  }
  if (currencyConflict && beforeValuation.currency && effectCurrency) {
    await recordValuationCurrencyConflict(ctx, {
      effectId,
      existingCurrency: beforeValuation.currency,
      organizationId: args.organizationId,
      recordedAt,
      sourceCurrency: effectCurrency,
      sourceDomain: args.sourceDomain,
      storeId: args.storeId,
    });
  }

  if (!requiresDeficitContinuation) {
    await persistDeficitLotTransition(ctx, {
      createdDeficitLot: transition.createdDeficitLot,
      effectId,
      existingLots: existingDeficitLots,
      ledgerId: deficitLedgerId,
      organizationId: args.organizationId,
      positionId,
      productSkuId: args.productSkuId,
      recordedAt,
      remainingDeficitLots: transition.remainingDeficitLots,
      storeId: args.storeId,
    });
  }

  const adjustmentEffects: Array<Doc<"reportingInventoryEffect">> = [];
  for (const adjustment of transition.adjustmentInputs) {
    const adjustmentId = await ctx.db.insert("reportingInventoryEffect", {
      organizationId: args.organizationId,
      storeId: args.storeId,
      productSkuId: args.productSkuId,
      positionId,
      sourceDomain: args.sourceDomain,
      businessEventKey: adjustment.businessEventKey,
      effectType: "deficit_resolution",
      occurrenceAt: args.occurrenceAt,
      ...(args.operatingDate !== undefined
        ? { operatingDate: args.operatingDate }
        : {}),
      ...(args.scheduleVersionId !== undefined
        ? { scheduleVersionId: args.scheduleVersionId }
        : {}),
      physicalQuantityDelta: 0,
      sellableQuantityDelta: 0,
      knownCostPoolDeltaMinor: 0,
      outboundBasisMinor: adjustment.knownCost,
      linkedOutboundEffectId:
        adjustment.outboundEffectId as Id<"reportingInventoryEffect">,
      revaluedQuantity: adjustment.quantity,
      costedQuantityDelta: 0,
      uncostedQuantityDelta: 0,
      unresolvedDeficitDelta: 0,
      currencyCode: adjustment.currency,
      ...(args.currencyMinorUnitScale !== undefined
        ? { currencyMinorUnitScale: args.currencyMinorUnitScale }
        : {}),
      contentFingerprint: adjustment.contentFingerprint,
      completeness: effectCompleteness,
      createdAt: recordedAt,
    });
    const adjustmentEffect = await ctx.db.get(
      "reportingInventoryEffect",
      adjustmentId,
    );
    if (!adjustmentEffect) {
      throw new Error("Deficit valuation adjustment could not be recorded.");
    }
    adjustmentEffects.push(adjustmentEffect);
    await insertSourceReference(ctx, {
      createdAt: recordedAt,
      effectId: adjustmentId,
      relation: adjustment.costLane,
      sourceId: adjustment.outboundEffectId,
      sourceType: "reportingInventoryBusinessEvent",
      storeId: args.storeId,
    });
    await recordInventoryEffectSkuEvidenceWithCtx(ctx, adjustmentEffect);
    const outboundEffect = await ctx.db.get(
      "reportingInventoryEffect",
      adjustment.outboundEffectId as Id<"reportingInventoryEffect">,
    );
    if (outboundEffect?.operatingDate && outboundEffect.scheduleVersionId) {
      const isMerchandiseAdjustment =
        adjustment.costLane === "historical_merchandise_cogs" ||
        adjustment.costLane === "historical_exchange_merchandise_cogs";
      const isRevenueMerchandiseAdjustment =
        adjustment.costLane === "historical_merchandise_cogs";
      const isInventoryConsumedAdjustment =
        adjustment.costLane === "historical_inventory_consumed";
      const coverage = isRevenueMerchandiseAdjustment
        ? await resolveDeficitCoveredRevenueWithCtx(ctx, {
            excludeResolutionEffectId: adjustmentId,
            nextQuantity: adjustment.quantity,
            organizationId: args.organizationId,
            outbound: outboundEffect,
            positionId,
            productSkuId: args.productSkuId,
            storeId: args.storeId,
          })
        : { coveredRevenueMinor: 0, originalFact: undefined };
      const coveredRevenueMinor = coverage.coveredRevenueMinor;
      const originalFact = coverage.originalFact;
      const factBusinessEventKey = `${adjustment.businessEventKey}:post_close_adjustment`;
      const existingFact = await ctx.db
        .query("reportingFact")
        .withIndex("by_storeId_sourceDomain_businessEventKey", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("sourceDomain", "inventory")
            .eq("businessEventKey", factBusinessEventKey),
        )
        .first();
      if (!existingFact) {
        const factId = await ctx.db.insert("reportingFact", {
          acceptedAt: recordedAt,
          ...(isMerchandiseAdjustment
            ? { adjustmentKind: "deficit_cogs_revaluation" as const }
            : {}),
          amountMinor: 0,
          businessEventKey: factBusinessEventKey,
          cogsKnownMinor: adjustment.knownCost,
          completeness: effectCompleteness,
          contentFingerprint: `deficit-cogs-revaluation:v1:${adjustmentId}:${adjustment.outboundEffectId}:${adjustment.knownCost}:${coveredRevenueMinor}`,
          costStatus: "known",
          coveredRevenueMinor,
          createdAt: recordedAt,
          currencyCode: adjustment.currency,
          currencyMinorUnitScale: args.currencyMinorUnitScale,
          valuationCurrencyCode: adjustment.currency,
          valuationCurrencyMinorUnitScale: args.currencyMinorUnitScale,
          factContractVersion: 1,
          factType: isMerchandiseAdjustment
            ? "post_close_adjustment"
            : isInventoryConsumedAdjustment
              ? "inventory_issue"
              : "inventory_adjustment",
          ...(isInventoryConsumedAdjustment
            ? { inventoryContributionKind: "inventory_consumed" as const }
            : {}),
          inventoryEffectId: adjustmentId,
          linkedBusinessEventKey: outboundEffect.businessEventKey,
          metricContractVersion: 1,
          occurrenceAt: outboundEffect.occurrenceAt,
          operatingDate: outboundEffect.operatingDate,
          organizationId: args.organizationId,
          productSkuId: args.productSkuId,
          quantity: isInventoryConsumedAdjustment ? 0 : adjustment.quantity,
          recognitionAt: outboundEffect.occurrenceAt,
          revenueCurrencyCode:
            originalFact?.revenueCurrencyCode ?? originalFact?.currencyCode,
          revenueCurrencyMinorUnitScale:
            originalFact?.revenueCurrencyMinorUnitScale ??
            originalFact?.currencyMinorUnitScale,
          scheduleVersionId: outboundEffect.scheduleVersionId,
          sourceDomain: "inventory",
          status: "canonical",
          storeId: args.storeId,
        });
        for (const [sourceId, relation] of [
          [String(adjustmentId), "owns"],
          [String(outboundEffect._id), "corrects"],
        ] as const) {
          await ctx.db.insert("reportingFactSourceReference", {
            createdAt: recordedAt,
            factId,
            relation,
            sourceId,
            sourceType: "reporting_inventory_effect",
            storeId: args.storeId,
          });
        }
        const createdFact = await ctx.db.get("reportingFact", factId);
        if (createdFact) {
          await recordFactSkuEvidenceWithCtx(ctx, createdFact);
        }
        await scheduleFactProjectionBatchWithCtx(ctx, [factId]);
      }
    }
  }

  await ctx.db.patch("productSku", args.productSkuId, {
    inventoryCount: nextOnHand,
    quantityAvailable: nextSellable,
  });

  let movement: Doc<"inventoryMovement"> | null = null;
  if (args.physicalQuantityDelta !== 0) {
    const movementArgs: RecordInventoryMovementArgs = {
      actorStaffProfileId: args.actorStaffProfileId,
      actorUserId: args.actorUserId,
      afterOnHandQuantity: nextOnHand,
      afterSellableQuantity: nextSellable,
      beforeOnHandQuantity: productSku.inventoryCount,
      beforeSellableQuantity: productSku.quantityAvailable,
      businessEventKey: args.businessEventKey,
      contentFingerprint: args.contentFingerprint,
      customerProfileId: args.customerProfileId,
      disposition:
        args.valuation.kind === "outbound" || args.valuation.kind === "return"
          ? args.valuation.disposition
          : args.valuation.kind,
      movementType: args.movementType,
      notes: args.notes,
      occurrenceAt: args.occurrenceAt,
      organizationId: args.organizationId,
      onlineOrderId: args.onlineOrderId,
      productId: args.productId,
      productSkuId: args.productSkuId,
      posTransactionId: args.posTransactionId,
      quantityDelta: args.physicalQuantityDelta,
      reasonCode: args.reasonCode,
      registerSessionId: args.registerSessionId,
      recordedAt,
      reportingInventoryEffectId: effectId,
      sellableQuantityDelta: args.sellableQuantityDelta,
      sourceId: args.sourceId,
      sourceLineId: args.sourceLineId,
      sourceType: args.sourceType,
      storeId: args.storeId,
      workItemId: args.workItemId,
    };
    const movementResult = await recordInventoryMovementWithDispositionWithCtx(
      ctx,
      movementArgs,
    );
    movement = movementResult.movement;
  } else {
    await recordSkuActivityEventWithCtx(ctx, {
      activityType: args.activityType,
      actorStaffProfileId: args.actorStaffProfileId,
      actorUserId: args.actorUserId,
      idempotencyKey: `reportingInventoryEffect:${effectId}`,
      metadata: {
        afterOnHandQuantity: nextOnHand,
        afterSellableQuantity: nextSellable,
        beforeOnHandQuantity: productSku.inventoryCount,
        beforeSellableQuantity: productSku.quantityAvailable,
        businessEventKey: args.businessEventKey,
        reportingInventoryEffectId: effectId,
        sellableQuantityDelta: args.sellableQuantityDelta,
      },
      occurredAt: args.occurrenceAt,
      organizationId: args.organizationId,
      productId: args.productId,
      productSkuId: args.productSkuId,
      quantityDelta: args.sellableQuantityDelta,
      sourceId: args.sourceId,
      sourceLineId: args.sourceLineId,
      sourceType: args.sourceType,
      status: args.activityStatus ?? "committed",
      storeId: args.storeId,
      workItemId: args.workItemId,
    });
  }

  const position = await ctx.db.get("reportingInventoryPosition", positionId);
  if (!position) throw new Error("Inventory position could not be recorded.");

  for (const insertedEffectId of [
    effectId,
    ...adjustmentEffects.map((adjustment) => adjustment._id),
  ]) {
    await scheduleInventoryEffectProjectionWithCtx(ctx, insertedEffectId);
  }

  return {
    adjustmentEffects,
    disposition: "inserted",
    effect,
    mode,
    movement,
    position,
  };
}

export async function applySkuValuationCorrectionWithCtx(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"athenaUser">;
    correctedInventoryCount: number;
    correctedQuantityAvailable: number;
    correctedUnitCostMinor: number | null;
    currencyCode: string;
    currencyMinorUnitScale: number;
    occurrenceAt: number;
    operatingDate?: string;
    organizationId: Id<"organization">;
    productSkuId: Id<"productSku">;
    reason: string;
    requestKey: string;
    scheduleVersionId?: Id<"storeSchedule">;
    storeId: Id<"store">;
  },
) {
  const normalizedRequestKey = args.requestKey.trim();
  const normalizedReason = args.reason.trim();
  const normalizedCurrencyCode = args.currencyCode.trim().toUpperCase();
  assertNonempty(normalizedRequestKey, "Valuation correction request key");
  assertNonempty(args.reason, "Valuation correction reason");
  assertInteger(args.correctedInventoryCount, "Corrected inventory count");
  assertInteger(
    args.correctedQuantityAvailable,
    "Corrected available quantity",
  );
  if (args.correctedUnitCostMinor !== null) {
    assertInteger(args.correctedUnitCostMinor, "Corrected unit cost");
  }
  if (
    args.correctedInventoryCount < 0 ||
    args.correctedQuantityAvailable < 0 ||
    args.correctedQuantityAvailable > args.correctedInventoryCount ||
    (args.correctedUnitCostMinor !== null && args.correctedUnitCostMinor < 0)
  ) {
    throw new Error("SKU valuation correction values are invalid.");
  }

  const priorCorrection = await ctx.db
    .query("reportingSkuValuationCorrection")
    .withIndex("by_storeId_requestKey", (q) =>
      q.eq("storeId", args.storeId).eq("requestKey", normalizedRequestKey),
    )
    .take(2);
  if (priorCorrection.length > 1) {
    throw new Error("SKU valuation correction identity is not unique.");
  }
  if (priorCorrection[0]) {
    const prior = priorCorrection[0];
    const replayMatches =
      prior.productSkuId === args.productSkuId &&
      prior.actorUserId === args.actorUserId &&
      prior.correctedInventoryCount === args.correctedInventoryCount &&
      prior.correctedQuantityAvailable === args.correctedQuantityAvailable &&
      (prior.correctedUnitCostMinor ?? null) === args.correctedUnitCostMinor &&
      prior.reason === normalizedReason &&
      (args.correctedUnitCostMinor === null ||
        prior.currencyCode?.trim().toUpperCase() === normalizedCurrencyCode);
    if (!replayMatches) {
      throw new Error(
        "SKU valuation correction request key conflicts with existing content.",
      );
    }
    const priorEffect = await ctx.db.get(
      "reportingInventoryEffect",
      priorCorrection[0].inventoryEffectId,
    );
    return {
      correctionId: prior._id,
      flags: {
        missingUnitCost: prior.correctedUnitCostMinor === undefined,
        reportingPeriodMissing:
          !priorEffect?.operatingDate || !priorEffect.scheduleVersionId,
        valuationRebuildRequired: false,
      },
      inventoryEffectId: prior.inventoryEffectId,
      replayed: true,
    };
  }

  const sku = await ctx.db.get("productSku", args.productSkuId);
  if (!sku || sku.storeId !== args.storeId) {
    throw new Error("Selected SKU could not be found for this store.");
  }
  const product = await ctx.db.get("product", sku.productId);
  if (
    !product ||
    product.storeId !== args.storeId ||
    product.organizationId !== args.organizationId
  ) {
    throw new Error("SKU product ownership does not match the selected store.");
  }
  const priorInventoryCount = sku.inventoryCount;
  const priorQuantityAvailable = sku.quantityAvailable;
  const priorUnitCostMinor = sku.unitCost;
  const physicalDelta = args.correctedInventoryCount - sku.inventoryCount;
  const sellableDelta = args.correctedQuantityAvailable - sku.quantityAvailable;
  const positionBeforeStock = await readSinglePosition(ctx, {
    productSkuId: args.productSkuId,
    storeId: args.storeId,
  });

  let stockEffectId: Id<"reportingInventoryEffect"> | undefined;
  if (physicalDelta !== 0 || sellableDelta !== 0 || !positionBeforeStock) {
    const stockResult = await applyInventoryEffectWithCtx(ctx, {
      activityType: "sku_valuation_correction_stock",
      actorUserId: args.actorUserId,
      businessEventKey: `${args.requestKey}:stock`,
      compatibilityBalance: {
        onHandQuantity: args.correctedInventoryCount,
        sellableQuantity: args.correctedQuantityAvailable,
      },
      completeness: "complete",
      contentFingerprint: [
        "sku-valuation-correction-stock-v1",
        args.productSkuId,
        priorInventoryCount,
        args.correctedInventoryCount,
        priorQuantityAvailable,
        args.correctedQuantityAvailable,
      ].join(":"),
      currencyMinorUnitScale: args.currencyMinorUnitScale,
      effectType: "adjustment",
      movementType: "sku_valuation_correction",
      notes: args.reason,
      occurrenceAt: args.occurrenceAt,
      ...(args.operatingDate && args.scheduleVersionId
        ? {
            operatingDate: args.operatingDate,
            scheduleVersionId: args.scheduleVersionId,
          }
        : {}),
      organizationId: args.organizationId,
      physicalQuantityDelta: physicalDelta,
      productId: sku.productId,
      productSkuId: sku._id,
      reasonCode: "full_admin_product_editor_correction",
      recordedAt: args.occurrenceAt,
      sellableQuantityDelta: sellableDelta,
      sourceDomain: "inventory",
      sourceId: args.requestKey,
      sourceType: "reporting_inventory_effect",
      storeId: args.storeId,
      valuation:
        physicalDelta > 0
          ? {
              costBasis:
                args.correctedUnitCostMinor === null
                  ? uncostedBasis()
                  : knownUnitCostBasis({
                      currency: args.currencyCode,
                      quantity: physicalDelta,
                      unitCost: args.correctedUnitCostMinor,
                    }),
              kind: "inbound",
              quantity: physicalDelta,
            }
          : physicalDelta < 0
            ? {
                disposition: "stock_correction",
                kind: "outbound",
                quantity: Math.abs(physicalDelta),
              }
            : { kind: "availability_only" },
    });
    stockEffectId = stockResult.effect._id;
  }

  const position = await readSinglePosition(ctx, {
    productSkuId: args.productSkuId,
    storeId: args.storeId,
  });
  if (!position) {
    throw new Error("SKU valuation position could not be initialized.");
  }
  const priorValuation = positionToValuation(position);
  const correctedKnownCostPoolMinor =
    args.correctedUnitCostMinor === null
      ? 0
      : args.correctedInventoryCount * args.correctedUnitCostMinor;
  const correctionBusinessEventKey = `${args.requestKey}:valuation`;
  const corrected = applyValuationCorrection(priorValuation, {
    actorId: String(args.actorUserId),
    costedQuantity:
      args.correctedUnitCostMinor === null ? 0 : args.correctedInventoryCount,
    currency: args.correctedUnitCostMinor === null ? null : args.currencyCode,
    effectId: correctionBusinessEventKey,
    knownCostPool: correctedKnownCostPoolMinor,
    occurredAt: args.occurrenceAt,
    reason: normalizedReason,
  });
  const committedAt = Date.now();
  await ctx.db.patch("reportingInventoryPosition", position._id, {
    costedQuantity: corrected.position.costedQuantity,
    currencyCode: corrected.position.currency ?? undefined,
    currencyMinorUnitScale:
      corrected.position.currency === null
        ? undefined
        : args.currencyMinorUnitScale,
    knownCostPoolMinor: corrected.position.knownCostPool,
    lastEffectAt: Math.max(position.lastEffectAt, args.occurrenceAt),
    uncostedQuantity: corrected.position.uncostedQuantity,
    updatedAt: committedAt,
    valuationPendingFrom: undefined,
    valuationStatus: "current",
    version: corrected.position.basisVersion,
  });
  const correctionEffectId = await ctx.db.insert("reportingInventoryEffect", {
    businessEventKey: correctionBusinessEventKey,
    completeness:
      position.mode === "compatibility_shadow" ? "provisional" : "complete",
    contentFingerprint: [
      "sku-valuation-correction-v1",
      args.productSkuId,
      priorValuation.knownCostPool,
      corrected.position.knownCostPool,
      priorValuation.costedQuantity,
      corrected.position.costedQuantity,
    ].join(":"),
    costLane: "inventory_adjustment",
    costedQuantityDelta:
      corrected.position.costedQuantity - priorValuation.costedQuantity,
    ...(corrected.position.currency
      ? {
          currencyCode: corrected.position.currency,
          currencyMinorUnitScale: args.currencyMinorUnitScale,
        }
      : {}),
    effectType: "adjustment",
    knownCostPoolDeltaMinor:
      corrected.position.knownCostPool - priorValuation.knownCostPool,
    occurrenceAt: args.occurrenceAt,
    ...(args.operatingDate && args.scheduleVersionId
      ? {
          operatingDate: args.operatingDate,
          scheduleVersionId: args.scheduleVersionId,
        }
      : {}),
    organizationId: args.organizationId,
    physicalQuantityDelta: 0,
    positionId: position._id,
    productSkuId: args.productSkuId,
    sellableQuantityDelta: 0,
    sourceDomain: "inventory",
    storeId: args.storeId,
    uncostedQuantityDelta:
      corrected.position.uncostedQuantity - priorValuation.uncostedQuantity,
    unresolvedDeficitDelta: 0,
    replayValuation: {
      costedQuantity: corrected.position.costedQuantity,
      currency: corrected.position.currency ?? undefined,
      kind: "valuation_correction",
      knownCostPoolMinor: corrected.position.knownCostPool,
      uncostedQuantity: corrected.position.uncostedQuantity,
      unresolvedDeficitQuantity: corrected.position.unresolvedDeficitQuantity,
    },
    valuationStatus: "current",
    createdAt: args.occurrenceAt,
  });
  await insertSourceReference(ctx, {
    createdAt: args.occurrenceAt,
    effectId: correctionEffectId,
    relation: "corrects",
    sourceId: args.requestKey,
    sourceType: "reporting_inventory_effect",
    storeId: args.storeId,
  });
  const correctionEffect = await ctx.db.get(
    "reportingInventoryEffect",
    correctionEffectId,
  );
  if (!correctionEffect) {
    throw new Error("SKU valuation correction effect was not persisted.");
  }
  await recordInventoryPositionRevisionWithCtx(ctx, {
    effectId: correctionEffectId,
    organizationId: args.organizationId,
    positionId: position._id,
    productSkuId: args.productSkuId,
    recordedAt: committedAt,
    revisionKind: "effect_applied",
    storeId: args.storeId,
  });
  await recordInventoryEffectSkuEvidenceWithCtx(ctx, correctionEffect);
  await ctx.db.patch("productSku", args.productSkuId, {
    unitCost: args.correctedUnitCostMinor ?? undefined,
  });
  const correctionId = await ctx.db.insert("reportingSkuValuationCorrection", {
    actorUserId: args.actorUserId,
    correctedInventoryCount: args.correctedInventoryCount,
    correctedKnownCostPoolMinor,
    correctedQuantityAvailable: args.correctedQuantityAvailable,
    correctedUnitCostMinor: args.correctedUnitCostMinor ?? undefined,
    createdAt: args.occurrenceAt,
    currencyCode:
      args.correctedUnitCostMinor === null ? undefined : args.currencyCode,
    inventoryEffectId: correctionEffectId,
    occurredAt: args.occurrenceAt,
    organizationId: args.organizationId,
    priorInventoryCount,
    priorKnownCostPoolMinor: priorValuation.knownCostPool,
    priorQuantityAvailable,
    priorUnitCostMinor,
    productSkuId: args.productSkuId,
    reason: normalizedReason,
    requestKey: normalizedRequestKey,
    storeId: args.storeId,
  });
  await recordSkuActivityEventWithCtx(ctx, {
    activityType: "sku_valuation_corrected",
    actorUserId: args.actorUserId,
    idempotencyKey: `reportingSkuValuationCorrection:${correctionId}`,
    metadata: {
      correctedInventoryCount: args.correctedInventoryCount,
      correctedQuantityAvailable: args.correctedQuantityAvailable,
      hasUnitCost: args.correctedUnitCostMinor !== null,
      reason: args.reason.trim(),
      reportingInventoryEffectId: correctionEffectId,
      stockEffectId,
    },
    occurredAt: args.occurrenceAt,
    organizationId: args.organizationId,
    productId: sku.productId,
    productSkuId: args.productSkuId,
    quantityDelta: 0,
    sourceId: String(correctionId),
    sourceType: "reporting_inventory_effect",
    status: "corrected",
    storeId: args.storeId,
  });
  await scheduleInventoryEffectProjectionWithCtx(ctx, correctionEffectId);

  return {
    correctionId,
    flags: {
      missingUnitCost: args.correctedUnitCostMinor === null,
      reportingPeriodMissing:
        args.operatingDate === undefined ||
        args.scheduleVersionId === undefined,
      valuationRebuildRequired: false,
    },
    inventoryEffectId: correctionEffectId,
    replayed: false,
    stockEffectId,
  };
}
