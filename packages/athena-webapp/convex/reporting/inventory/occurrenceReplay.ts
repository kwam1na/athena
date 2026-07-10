import { v } from "convex/values";

import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "../../_generated/server";
import { scheduleReportingWorkBestEffort } from "../scheduling";
import { recordInventoryPositionRevisionWithCtx } from "./positionRevisions";
import { createCandidateDeficitLedgerWithCtx } from "./deficitLedger";
import { recordFactSkuEvidenceWithCtx } from "../evidence";
import { scheduleFactProjectionBatchWithCtx } from "../projectionWork";
import type { InventoryValuationPosition, UnresolvedDeficitLot } from "./types";
import {
  applyInboundValuation,
  applyOutboundValuation,
  applyReturnValuation,
} from "./valuation";

export const INVENTORY_OCCURRENCE_REPLAY_PAGE_SIZE = 20;
export const INVENTORY_REPLAY_ATOMIC_FINANCIAL_WRITE_LIMIT = 20;
export const INVENTORY_REPLAY_ATOMIC_OUTCOME_LIMIT =
  INVENTORY_REPLAY_ATOMIC_FINANCIAL_WRITE_LIMIT;
export const INVENTORY_REPLAY_OWNERSHIP_COMPARE_LIMIT = 100;

const occurrenceReplayInternal = (internal as any).reporting.inventory
  .occurrenceReplay;

function replayPosition(
  replay: Doc<"reportingInventoryOccurrenceReplay">,
): InventoryValuationPosition {
  return {
    basisVersion: replay.version,
    costedQuantity: replay.costedQuantity,
    currency: replay.currencyCode ?? null,
    knownCostPool: replay.knownCostPoolMinor,
    uncostedQuantity: replay.uncostedQuantity,
    unresolvedDeficitQuantity: replay.unresolvedDeficitQuantity,
  };
}

function positionPatch(position: InventoryValuationPosition) {
  return {
    costedQuantity: position.costedQuantity,
    currencyCode: position.currency ?? undefined,
    knownCostPoolMinor: position.knownCostPool,
    uncostedQuantity: position.uncostedQuantity,
    unresolvedDeficitQuantity: position.unresolvedDeficitQuantity,
    version: position.basisVersion,
  };
}

export function applyOccurrenceReplayEffect(
  position: InventoryValuationPosition,
  effect: Pick<
    Doc<"reportingInventoryEffect">,
    | "businessEventKey"
    | "occurrenceAt"
    | "physicalQuantityDelta"
    | "replayValuation"
  >,
) {
  const valuation = effect.replayValuation;
  if (!valuation) {
    throw new Error("Inventory effect is missing occurrence replay input");
  }
  const aggregateDeficitLots = (): UnresolvedDeficitLot[] =>
    position.unresolvedDeficitQuantity === 0
      ? []
      : [
          {
            costLane: "inventory_adjustment",
            occurredAt: effect.occurrenceAt,
            outboundEffectId: "occurrence-replay-aggregate",
            remainingQuantity: position.unresolvedDeficitQuantity,
          },
        ];
  switch (valuation.kind) {
    case "availability_only":
      if (effect.physicalQuantityDelta !== 0) {
        throw new Error(
          "Availability-only replay cannot change on-hand quantity",
        );
      }
      return { ...position, basisVersion: position.basisVersion + 1 };
    case "inbound":
      return applyInboundValuation(position, {
        costBasis: valuation.costBasis,
        deficitLots: aggregateDeficitLots(),
        inboundEffectId: effect.businessEventKey,
        quantity: valuation.quantity,
      }).position;
    case "outbound":
      return applyOutboundValuation(position, {
        disposition: valuation.disposition,
        occurredAt: effect.occurrenceAt,
        outboundEffectId: effect.businessEventKey,
        quantity: valuation.quantity,
      }).position;
    case "return":
      return applyReturnValuation(position, {
        deficitLots: aggregateDeficitLots(),
        disposition: valuation.disposition,
        occurredAt: effect.occurrenceAt,
        originalBasis: valuation.originalBasis,
        quantity: valuation.quantity,
        returnEffectId: effect.businessEventKey,
      }).position;
    case "valuation_correction":
      return {
        basisVersion: position.basisVersion + 1,
        costedQuantity: valuation.costedQuantity,
        currency: valuation.currency ?? null,
        knownCostPool: valuation.knownCostPoolMinor,
        uncostedQuantity: valuation.uncostedQuantity,
        unresolvedDeficitQuantity: valuation.unresolvedDeficitQuantity,
      };
  }
}

export function applyOccurrenceReplayTransition(
  position: InventoryValuationPosition,
  deficitLots: UnresolvedDeficitLot[],
  effect: Pick<
    Doc<"reportingInventoryEffect">,
    | "_id"
    | "businessEventKey"
    | "occurrenceAt"
    | "physicalQuantityDelta"
    | "replayValuation"
  >,
) {
  const valuation = effect.replayValuation;
  if (!valuation) throw new Error("Inventory effect is missing replay input");
  if (valuation.kind === "inbound") {
    const result = applyInboundValuation(position, {
      costBasis: valuation.costBasis,
      deficitLots,
      inboundEffectId: String(effect._id),
      quantity: valuation.quantity,
    });
    return {
      deficitLots: result.remainingDeficitLots,
      position: result.position,
    };
  }
  if (valuation.kind === "return") {
    const result = applyReturnValuation(position, {
      deficitLots,
      disposition: valuation.disposition,
      occurredAt: effect.occurrenceAt,
      originalBasis: valuation.originalBasis,
      quantity: valuation.quantity,
      returnEffectId: String(effect._id),
    });
    return {
      deficitLots: result.remainingDeficitLots,
      position: result.position,
    };
  }
  if (valuation.kind === "outbound") {
    const result = applyOutboundValuation(position, {
      disposition: valuation.disposition,
      occurredAt: effect.occurrenceAt,
      outboundEffectId: String(effect._id),
      quantity: valuation.quantity,
    });
    return {
      deficitLots: result.createdDeficitLot
        ? [...deficitLots, result.createdDeficitLot]
        : deficitLots,
      position: result.position,
    };
  }
  if (valuation.kind === "valuation_correction") {
    const currentDeficit = deficitLots.reduce(
      (sum, lot) => sum + lot.remainingQuantity,
      0,
    );
    if (currentDeficit !== position.unresolvedDeficitQuantity) {
      throw new Error("Occurrence replay correction lot state is inconsistent");
    }
    let quantityToRemove = Math.max(
      0,
      currentDeficit - valuation.unresolvedDeficitQuantity,
    );
    const reconciledLots = deficitLots.flatMap((lot) => {
      const removed = Math.min(lot.remainingQuantity, quantityToRemove);
      quantityToRemove -= removed;
      const remainingQuantity = lot.remainingQuantity - removed;
      return remainingQuantity > 0 ? [{ ...lot, remainingQuantity }] : [];
    });
    if (valuation.unresolvedDeficitQuantity > currentDeficit) {
      reconciledLots.push({
        costLane: "inventory_adjustment",
        occurredAt: effect.occurrenceAt,
        outboundEffectId: String(effect._id),
        remainingQuantity: valuation.unresolvedDeficitQuantity - currentDeficit,
      });
    }
    return {
      deficitLots: reconciledLots,
      position: applyOccurrenceReplayEffect(position, effect),
    };
  }
  return {
    deficitLots,
    position: applyOccurrenceReplayEffect(position, effect),
  };
}

function baselineReplayValue(
  baseline: Doc<"reportingCutoverBaseline">,
  now: number,
) {
  return {
    actualApplyCursor: undefined,
    baselineId: baseline._id,
    completedAt: undefined,
    costedQuantity: baseline.costedQuantity,
    createdAt: now,
    currencyCode: baseline.currencyCode,
    cursor: undefined,
    frozenWatermark: Math.max(0, now - 1),
    knownCostPoolMinor: baseline.knownCostPoolMinor,
    lastEffectAt: baseline.effectiveAt,
    latestFailureAt: undefined,
    latestFailureCode: undefined,
    lotSeedCursor: undefined,
    pendingCostedQuantity: undefined,
    pendingCorrectionTargetDeficit: undefined,
    pendingEffectId: undefined,
    pendingKnownCostMinor: undefined,
    pendingUncostedQuantity: undefined,
    phase: "seeding" as const,
    processedCount: 0,
    seededDeficitQuantity: 0,
    status: "pending" as const,
    uncostedQuantity: baseline.uncostedQuantity,
    unresolvedDeficitQuantity: baseline.unresolvedDeficitQuantity,
    updatedAt: now,
    version: baseline.version,
  };
}

function knownReplayCurrency(effect: Doc<"reportingInventoryEffect">) {
  const valuation = effect.replayValuation;
  if (valuation?.kind === "inbound" && valuation.costBasis.kind === "known") {
    return valuation.costBasis.currency;
  }
  if (
    valuation?.kind === "return" &&
    valuation.disposition === "sellable" &&
    valuation.originalBasis.costedQuantity > 0
  ) {
    return valuation.originalBasis.currency;
  }
  return null;
}

export function assertOccurrenceReplayCurrencyCompatible(
  position: InventoryValuationPosition,
  effect: Doc<"reportingInventoryEffect">,
) {
  const incomingCurrency = knownReplayCurrency(effect);
  if (
    position.currency &&
    incomingCurrency &&
    position.currency !== incomingCurrency
  ) {
    throw new Error("Occurrence replay currency conflict requires correction");
  }
}

export function validateOccurrenceReplayOutcomeQuantities(input: {
  costedQuantity: number;
  quantity: number;
  uncostedQuantity: number;
  unresolvedDeficitQuantity: number;
}) {
  if (
    input.costedQuantity < 0 ||
    input.uncostedQuantity < 0 ||
    input.unresolvedDeficitQuantity < 0 ||
    input.costedQuantity +
      input.uncostedQuantity +
      input.unresolvedDeficitQuantity !==
      input.quantity
  ) {
    throw new Error("Occurrence replay outcome quantities do not reconcile");
  }
}

const REPLAY_OUTCOME_SEMANTIC_FIELDS = [
  "basisCostedQuantity",
  "basisUncostedQuantity",
  "basisUnresolvedDeficitQuantity",
  "basisVersion",
  "costedQuantity",
  "costLane",
  "currencyCode",
  "currencyMinorUnitScale",
  "knownCostMinor",
  "knownCostPoolBeforeMinor",
  "occurrenceAt",
  "operatingDate",
  "outcomeKind",
  "quantity",
  "roundedWeightedAverageUnitCostMinor",
  "scheduleVersionId",
  "uncostedQuantity",
  "unresolvedDeficitQuantity",
] as const;

export function occurrenceReplayOutcomesMatch(
  left: Partial<Doc<"reportingInventoryOccurrenceReplayOutcome">>,
  right: Partial<Doc<"reportingInventoryOccurrenceReplayOutcome">>,
) {
  return REPLAY_OUTCOME_SEMANTIC_FIELDS.every(
    (field) => left[field] === right[field],
  );
}

async function stageReplayOutcomeWithCtx(
  ctx: MutationCtx,
  input: Omit<
    Doc<"reportingInventoryOccurrenceReplayOutcome">,
    "_creationTime" | "_id" | "appliedAt" | "createdAt" | "status"
  >,
) {
  validateOccurrenceReplayOutcomeQuantities(input);
  const existing = await ctx.db
    .query("reportingInventoryOccurrenceReplayOutcome")
    .withIndex("by_replayId_effectId_outcomeKind", (query) =>
      query
        .eq("replayId", input.replayId)
        .eq("effectId", input.effectId)
        .eq("outcomeKind", input.outcomeKind),
    )
    .first();
  if (existing) return existing._id;
  const latestSettled = await readLatestSettledOutcomeWithCtx(ctx, {
    effectId: input.effectId,
    outcomeKind: input.outcomeKind,
  });
  if (
    latestSettled?.status === "applied" &&
    occurrenceReplayOutcomesMatch(latestSettled, input)
  ) {
    return latestSettled._id;
  }
  return ctx.db.insert("reportingInventoryOccurrenceReplayOutcome", {
    ...input,
    createdAt: Date.now(),
    status: "candidate",
  });
}

async function readLatestSettledOutcomeWithCtx(
  ctx: MutationCtx,
  input: {
    effectId: Id<"reportingInventoryEffect">;
    outcomeKind: "outbound_basis" | "return_reversal";
  },
) {
  return ctx.db
    .query("reportingInventoryOccurrenceReplayOutcome")
    .withIndex("by_effectId_outcomeKind_settledAt", (query) =>
      query
        .eq("effectId", input.effectId)
        .eq("outcomeKind", input.outcomeKind)
        .gt("settledAt", 0),
    )
    .order("desc")
    .first();
}

type CandidateReplayOutcome = Omit<
  Doc<"reportingInventoryOccurrenceReplayOutcome">,
  "_creationTime" | "_id" | "appliedAt" | "createdAt" | "status"
>;

export function shouldStageOccurrenceReplayOutcome(
  effect: Pick<
    Doc<"reportingInventoryEffect">,
    | "cogsReversalKnownMinor"
    | "completeness"
    | "costLane"
    | "costedQuantityDelta"
    | "currencyCode"
    | "outboundBasisMinor"
    | "uncostedQuantityDelta"
    | "unresolvedDeficitDelta"
    | "valuationStatus"
  >,
  outcome: Pick<
    CandidateReplayOutcome,
    | "costedQuantity"
    | "costLane"
    | "currencyCode"
    | "knownCostMinor"
    | "outcomeKind"
    | "uncostedQuantity"
    | "unresolvedDeficitQuantity"
  >,
) {
  if (effect.valuationStatus === "rebuild_required") return true;
  if (effect.costLane !== outcome.costLane) return true;
  if (outcome.currencyCode && effect.currencyCode !== outcome.currencyCode) {
    return true;
  }
  if (outcome.outcomeKind === "return_reversal") {
    return effect.cogsReversalKnownMinor !== outcome.knownCostMinor;
  }
  return (
    effect.outboundBasisMinor !== outcome.knownCostMinor ||
    Math.max(0, -effect.costedQuantityDelta) !== outcome.costedQuantity ||
    Math.max(0, -effect.uncostedQuantityDelta) !== outcome.uncostedQuantity ||
    Math.max(0, effect.unresolvedDeficitDelta) !==
      outcome.unresolvedDeficitQuantity ||
    effect.completeness === "stale" ||
    effect.completeness === "unavailable"
  );
}

export function occurrenceReplayDeficitOwnershipMatches(
  activeLots: ReadonlyArray<{
    outboundEffectId: unknown;
    remainingQuantity: number;
  }>,
  candidateLots: ReadonlyArray<{
    outboundEffectId: unknown;
    remainingQuantity: number;
  }>,
) {
  if (activeLots.length !== candidateLots.length) return false;
  const candidateByOutbound = new Map(
    candidateLots.map((lot) => [
      String(lot.outboundEffectId),
      lot.remainingQuantity,
    ]),
  );
  return activeLots.every(
    (lot) =>
      candidateByOutbound.get(String(lot.outboundEffectId)) ===
      lot.remainingQuantity,
  );
}

export function occurrenceReplayChangedDeficitOwners(
  activeLots: ReadonlyArray<{
    outboundEffectId: unknown;
    remainingQuantity: number;
  }>,
  candidateLots: ReadonlyArray<{
    outboundEffectId: unknown;
    remainingQuantity: number;
  }>,
) {
  const activeByOutbound = new Map(
    activeLots.map((lot) => [
      String(lot.outboundEffectId),
      lot.remainingQuantity,
    ]),
  );
  const candidateByOutbound = new Map(
    candidateLots.map((lot) => [
      String(lot.outboundEffectId),
      lot.remainingQuantity,
    ]),
  );
  return Array.from(
    new Set([...activeByOutbound.keys(), ...candidateByOutbound.keys()]),
  ).filter(
    (outboundEffectId) =>
      activeByOutbound.get(outboundEffectId) !==
      candidateByOutbound.get(outboundEffectId),
  );
}

export function occurrenceReplayOwnershipConflictRequiresFailClose(
  changedOutboundEffectIds: readonly string[],
  materiallyResolvedOutboundEffectIds: readonly string[],
) {
  const resolved = new Set(materiallyResolvedOutboundEffectIds);
  return changedOutboundEffectIds.some((effectId) => resolved.has(effectId));
}

export async function startOrResumeOccurrenceReplayWithCtx(
  ctx: MutationCtx,
  input: {
    organizationId: Id<"organization">;
    positionId: Id<"reportingInventoryPosition">;
    productSkuId: Id<"productSku">;
    storeId: Id<"store">;
  },
) {
  const baseline = await ctx.db
    .query("reportingCutoverBaseline")
    .withIndex("by_storeId_productSkuId_status", (query) =>
      query
        .eq("storeId", input.storeId)
        .eq("productSkuId", input.productSkuId)
        .eq("status", "accepted"),
    )
    .order("desc")
    .first();
  if (!baseline)
    throw new Error("Occurrence replay requires an accepted baseline");
  const existing = await ctx.db
    .query("reportingInventoryOccurrenceReplay")
    .withIndex("by_positionId", (query) =>
      query.eq("positionId", input.positionId),
    )
    .order("desc")
    .first();
  if (existing && ["pending", "running"].includes(existing.status)) {
    await scheduleReportingWorkBestEffort(
      ctx,
      occurrenceReplayInternal.processOccurrenceReplay,
      { replayId: existing._id },
    );
    return existing._id;
  }
  const now = Date.now();
  const position = await ctx.db.get(
    "reportingInventoryPosition",
    input.positionId,
  );
  if (!position?.deficitLedgerId) {
    throw new Error("Occurrence replay requires an active deficit ledger");
  }
  const candidateLedgerId = await createCandidateDeficitLedgerWithCtx(ctx, {
    organizationId: input.organizationId,
    positionId: input.positionId,
    productSkuId: input.productSkuId,
    recordedAt: now,
    storeId: input.storeId,
  });
  const replayId = await ctx.db.insert("reportingInventoryOccurrenceReplay", {
    ...baselineReplayValue(baseline, now),
    attemptCount: (existing?.attemptCount ?? 0) + 1,
    candidateLedgerId,
    organizationId: input.organizationId,
    positionId: input.positionId,
    productSkuId: input.productSkuId,
    sourceLedgerId: position.deficitLedgerId,
    storeId: input.storeId,
  });
  await ctx.db.patch("reportingInventoryDeficitLedger", candidateLedgerId, {
    replayId,
  });
  await scheduleReportingWorkBestEffort(
    ctx,
    occurrenceReplayInternal.processOccurrenceReplay,
    { replayId },
  );
  return replayId;
}

async function processSeedBatch(
  ctx: MutationCtx,
  replay: Doc<"reportingInventoryOccurrenceReplay">,
) {
  const page = await ctx.db
    .query("reportingCutoverBaselineDeficitLot")
    .withIndex("by_baselineId", (query) =>
      query.eq("baselineId", replay.baselineId),
    )
    .paginate({
      cursor: replay.lotSeedCursor ?? null,
      numItems: INVENTORY_OCCURRENCE_REPLAY_PAGE_SIZE,
    });
  let seededDeficitQuantity = replay.seededDeficitQuantity;
  const now = Date.now();
  for (const lot of page.page) {
    const existing = await ctx.db
      .query("reportingInventoryOccurrenceReplayLot")
      .withIndex("by_replayId_outboundEffectId", (query) =>
        query
          .eq("replayId", replay._id)
          .eq("outboundEffectId", lot.outboundEffectId),
      )
      .first();
    if (existing) continue;
    await ctx.db.insert("reportingInventoryOccurrenceReplayLot", {
      costLane: lot.costLane,
      createdAt: now,
      occurredAt: lot.occurredAt,
      organizationId: replay.organizationId,
      outboundEffectId: lot.outboundEffectId,
      positionId: replay.positionId,
      productSkuId: replay.productSkuId,
      remainingQuantity: lot.remainingQuantity,
      replayId: replay._id,
      status: "open",
      storeId: replay.storeId,
      updatedAt: now,
    });
    seededDeficitQuantity += lot.remainingQuantity;
  }
  if (
    page.isDone &&
    seededDeficitQuantity !== replay.unresolvedDeficitQuantity
  ) {
    throw new Error(
      "Occurrence replay baseline deficit snapshot is incomplete",
    );
  }
  await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
    lotSeedCursor: page.continueCursor,
    phase: page.isDone ? "replaying" : "seeding",
    seededDeficitQuantity,
    status: "running",
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(
    0,
    occurrenceReplayInternal.processOccurrenceReplay,
    { replayId: replay._id },
  );
}

function returnTranches(
  valuation: Extract<
    NonNullable<Doc<"reportingInventoryEffect">["replayValuation"]>,
    { kind: "return" }
  >,
) {
  if (valuation.disposition !== "sellable") {
    return { costed: 0, knownCost: 0, uncosted: 0 };
  }
  const uncosted = Math.min(
    valuation.originalBasis.uncostedQuantity,
    valuation.quantity,
  );
  const costed = valuation.quantity - uncosted;
  const knownCost =
    costed === 0
      ? 0
      : Math.round(
          (valuation.originalBasis.allocatedKnownCost * costed) /
            valuation.originalBasis.costedQuantity,
        );
  return { costed, knownCost, uncosted };
}

function pendingTranches(effect: Doc<"reportingInventoryEffect">) {
  const valuation = effect.replayValuation;
  if (!valuation) throw new Error("Inventory effect is missing replay input");
  if (valuation.kind === "inbound") {
    return valuation.costBasis.kind === "known"
      ? {
          costed: valuation.quantity,
          knownCost: valuation.costBasis.totalCost,
          uncosted: 0,
        }
      : { costed: 0, knownCost: 0, uncosted: valuation.quantity };
  }
  if (valuation.kind === "return") return returnTranches(valuation);
  return null;
}

function allocateRemainingCost(
  remainingCost: number,
  quantity: number,
  remainingQuantity: number,
) {
  if (quantity === remainingQuantity) return remainingCost;
  return Math.round((remainingCost * quantity) / remainingQuantity);
}

async function processPendingInbound(
  ctx: MutationCtx,
  replay: Doc<"reportingInventoryOccurrenceReplay">,
  effect: Doc<"reportingInventoryEffect">,
) {
  let position = replayPosition(replay);
  assertOccurrenceReplayCurrencyCompatible(position, effect);
  const currencyQuarantines = await ctx.db
    .query("reportingQuarantine")
    .withIndex("by_inventoryEffectId", (query) =>
      query.eq("inventoryEffectId", effect._id),
    )
    .take(20);
  if (
    currencyQuarantines.some(
      (row) =>
        row.status === "open" && row.safeCode === "valuation_currency_conflict",
    )
  ) {
    throw new Error("Occurrence replay currency conflict requires correction");
  }
  let pendingUncosted = replay.pendingUncostedQuantity ?? 0;
  let pendingCosted = replay.pendingCostedQuantity ?? 0;
  let pendingKnownCost = replay.pendingKnownCostMinor ?? 0;
  const lots = await ctx.db
    .query("reportingInventoryOccurrenceReplayLot")
    .withIndex("by_replayId_status_occurredAt_outboundEffectId", (query) =>
      query.eq("replayId", replay._id).eq("status", "open"),
    )
    .order("asc")
    .take(INVENTORY_OCCURRENCE_REPLAY_PAGE_SIZE);
  let touched = 0;
  const now = Date.now();
  for (const lot of lots) {
    let lotRemaining = lot.remainingQuantity;
    const uncostedResolved = Math.min(
      lotRemaining,
      pendingUncosted,
      position.unresolvedDeficitQuantity,
    );
    lotRemaining -= uncostedResolved;
    pendingUncosted -= uncostedResolved;
    position.unresolvedDeficitQuantity -= uncostedResolved;
    const costedResolved = Math.min(
      lotRemaining,
      pendingCosted,
      position.unresolvedDeficitQuantity,
    );
    if (costedResolved > 0) {
      const allocated = allocateRemainingCost(
        pendingKnownCost,
        costedResolved,
        pendingCosted,
      );
      pendingKnownCost -= allocated;
      pendingCosted -= costedResolved;
      position.unresolvedDeficitQuantity -= costedResolved;
      lotRemaining -= costedResolved;
    }
    await ctx.db.patch("reportingInventoryOccurrenceReplayLot", lot._id, {
      remainingQuantity: lotRemaining,
      status: lotRemaining === 0 ? "resolved" : "open",
      updatedAt: now,
    });
    touched += 1;
    if (pendingUncosted + pendingCosted === 0) break;
  }
  if (position.unresolvedDeficitQuantity === 0) {
    if (pendingCosted > 0) {
      position.costedQuantity += pendingCosted;
      position.knownCostPool += pendingKnownCost;
      position.currency = position.currency ?? effect.currencyCode ?? null;
      pendingCosted = 0;
      pendingKnownCost = 0;
    }
    position.uncostedQuantity += pendingUncosted;
    pendingUncosted = 0;
  }
  const complete = pendingUncosted + pendingCosted === 0;
  if (!complete && touched < INVENTORY_OCCURRENCE_REPLAY_PAGE_SIZE) {
    throw new Error("Occurrence replay deficit lots do not reconcile");
  }
  const patch = {
    ...positionPatch({
      ...position,
      basisVersion: complete
        ? position.basisVersion + 1
        : position.basisVersion,
    }),
    lastEffectAt: complete
      ? Math.max(replay.lastEffectAt, effect.occurrenceAt)
      : replay.lastEffectAt,
    pendingCostedQuantity: complete ? undefined : pendingCosted,
    pendingEffectId: complete ? undefined : effect._id,
    pendingKnownCostMinor: complete ? undefined : pendingKnownCost,
    pendingUncostedQuantity: complete ? undefined : pendingUncosted,
    processedCount: complete
      ? replay.processedCount + 1
      : replay.processedCount,
    status: "running" as const,
    updatedAt: now,
  };
  if (complete) {
    const valuation = effect.replayValuation;
    if (
      valuation?.kind === "return" &&
      valuation.disposition === "sellable" &&
      valuation.financialContribution === "reverse_original_lane"
    ) {
      const restored = returnTranches(valuation);
      const outcome: CandidateReplayOutcome = {
        costedQuantity: restored.costed,
        costLane: valuation.originalCostLane,
        currencyCode: valuation.originalBasis.currency ?? undefined,
        currencyMinorUnitScale: effect.currencyMinorUnitScale,
        effectId: effect._id,
        knownCostMinor: restored.knownCost,
        occurrenceAt: effect.occurrenceAt,
        operatingDate: effect.operatingDate,
        organizationId: replay.organizationId,
        outcomeKind: "return_reversal",
        positionId: replay.positionId,
        productSkuId: replay.productSkuId,
        quantity: valuation.quantity,
        replayId: replay._id,
        scheduleVersionId: effect.scheduleVersionId,
        storeId: replay.storeId,
        uncostedQuantity: restored.uncosted,
        unresolvedDeficitQuantity: 0,
      };
      if (shouldStageOccurrenceReplayOutcome(effect, outcome)) {
        await stageReplayOutcomeWithCtx(ctx, outcome);
      }
    }
    const page = await ctx.db
      .query("reportingInventoryEffect")
      .withIndex("by_positionId_occurrenceAt", (query) =>
        query.eq("positionId", replay.positionId),
      )
      .paginate({ cursor: replay.cursor ?? null, numItems: 1 });
    if (page.page[0]?._id !== effect._id) {
      throw new Error("Occurrence replay effect cursor changed");
    }
    await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
      ...patch,
      cursor: page.continueCursor,
    });
  } else {
    await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, patch);
  }
  await ctx.scheduler.runAfter(
    0,
    occurrenceReplayInternal.processOccurrenceReplay,
    { replayId: replay._id },
  );
}

async function processPendingCorrection(
  ctx: MutationCtx,
  replay: Doc<"reportingInventoryOccurrenceReplay">,
  effect: Doc<"reportingInventoryEffect">,
) {
  const valuation = effect.replayValuation;
  if (!valuation || valuation.kind !== "valuation_correction") {
    throw new Error("Occurrence replay correction input disappeared");
  }
  const target = replay.pendingCorrectionTargetDeficit;
  if (target === undefined) {
    throw new Error("Occurrence replay correction target is missing");
  }
  let currentDeficit = replay.unresolvedDeficitQuantity;
  const now = Date.now();
  if (target > currentDeficit) {
    await ctx.db.insert("reportingInventoryOccurrenceReplayLot", {
      costLane: "inventory_adjustment",
      createdAt: now,
      occurredAt: effect.occurrenceAt,
      organizationId: replay.organizationId,
      outboundEffectId: effect._id,
      positionId: replay.positionId,
      productSkuId: replay.productSkuId,
      remainingQuantity: target - currentDeficit,
      replayId: replay._id,
      status: "open",
      storeId: replay.storeId,
      updatedAt: now,
    });
    currentDeficit = target;
  } else if (target < currentDeficit) {
    const lots = await ctx.db
      .query("reportingInventoryOccurrenceReplayLot")
      .withIndex("by_replayId_status_occurredAt_outboundEffectId", (query) =>
        query.eq("replayId", replay._id).eq("status", "open"),
      )
      .order("asc")
      .take(INVENTORY_OCCURRENCE_REPLAY_PAGE_SIZE);
    for (const lot of lots) {
      const removed = Math.min(lot.remainingQuantity, currentDeficit - target);
      const remainingQuantity = lot.remainingQuantity - removed;
      currentDeficit -= removed;
      await ctx.db.patch("reportingInventoryOccurrenceReplayLot", lot._id, {
        remainingQuantity,
        status: remainingQuantity === 0 ? "resolved" : "open",
        updatedAt: now,
      });
      if (currentDeficit === target) break;
    }
    if (
      currentDeficit > target &&
      lots.length < INVENTORY_OCCURRENCE_REPLAY_PAGE_SIZE
    ) {
      throw new Error(
        "Occurrence replay correction deficit evidence is incomplete",
      );
    }
  }
  if (currentDeficit !== target) {
    await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
      unresolvedDeficitQuantity: currentDeficit,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      occurrenceReplayInternal.processOccurrenceReplay,
      { replayId: replay._id },
    );
    return;
  }
  const page = await ctx.db
    .query("reportingInventoryEffect")
    .withIndex("by_positionId_occurrenceAt", (query) =>
      query.eq("positionId", replay.positionId),
    )
    .paginate({ cursor: replay.cursor ?? null, numItems: 1 });
  if (page.page[0]?._id !== effect._id) {
    throw new Error("Occurrence replay correction cursor changed");
  }
  await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
    costedQuantity: valuation.costedQuantity,
    currencyCode: valuation.currency,
    cursor: page.continueCursor,
    knownCostPoolMinor: valuation.knownCostPoolMinor,
    lastEffectAt: Math.max(replay.lastEffectAt, effect.occurrenceAt),
    pendingCorrectionTargetDeficit: undefined,
    pendingEffectId: undefined,
    processedCount: replay.processedCount + 1,
    uncostedQuantity: valuation.uncostedQuantity,
    unresolvedDeficitQuantity: target,
    updatedAt: now,
    version: replay.version + 1,
  });
  await ctx.scheduler.runAfter(
    0,
    occurrenceReplayInternal.processOccurrenceReplay,
    { replayId: replay._id },
  );
}

async function beginOrApplyEffect(
  ctx: MutationCtx,
  replay: Doc<"reportingInventoryOccurrenceReplay">,
) {
  if (replay.pendingEffectId) {
    const pending = await ctx.db.get(
      "reportingInventoryEffect",
      replay.pendingEffectId,
    );
    if (!pending)
      throw new Error("Occurrence replay pending effect disappeared");
    if (replay.pendingCorrectionTargetDeficit !== undefined) {
      await processPendingCorrection(ctx, replay, pending);
    } else {
      await processPendingInbound(ctx, replay, pending);
    }
    return;
  }
  const page = await ctx.db
    .query("reportingInventoryEffect")
    .withIndex("by_positionId_occurrenceAt", (query) =>
      query.eq("positionId", replay.positionId),
    )
    .paginate({ cursor: replay.cursor ?? null, numItems: 1 });
  const effect = page.page[0];
  if (!effect) {
    await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
      phase: "applying_candidate",
      status: "running",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      occurrenceReplayInternal.processOccurrenceReplay,
      { replayId: replay._id },
    );
    return;
  }
  if (
    effect._creationTime <=
      (await ctx.db.get("reportingCutoverBaseline", replay.baselineId))!
        ._creationTime ||
    effect._creationTime > replay.frozenWatermark ||
    effect.effectType === "baseline" ||
    effect.effectType === "deficit_resolution"
  ) {
    await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
      cursor: page.continueCursor,
      status: "running",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      occurrenceReplayInternal.processOccurrenceReplay,
      { replayId: replay._id },
    );
    return;
  }
  if (
    effect.storeId !== replay.storeId ||
    effect.productSkuId !== replay.productSkuId
  ) {
    throw new Error("Occurrence replay effect ownership mismatch");
  }
  const tranches = pendingTranches(effect);
  if (tranches) {
    await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
      pendingCostedQuantity: tranches.costed,
      pendingEffectId: effect._id,
      pendingKnownCostMinor: tranches.knownCost,
      pendingUncostedQuantity: tranches.uncosted,
      status: "running",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      occurrenceReplayInternal.processOccurrenceReplay,
      { replayId: replay._id },
    );
    return;
  }
  if (effect.replayValuation?.kind === "valuation_correction") {
    await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
      pendingCorrectionTargetDeficit:
        effect.replayValuation.unresolvedDeficitQuantity,
      pendingEffectId: effect._id,
      status: "running",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      occurrenceReplayInternal.processOccurrenceReplay,
      { replayId: replay._id },
    );
    return;
  }
  const before = replayPosition(replay);
  let after: InventoryValuationPosition;
  if (effect.replayValuation?.kind === "outbound") {
    const valuation = effect.replayValuation;
    const result = applyOutboundValuation(before, {
      disposition: valuation.disposition,
      occurredAt: effect.occurrenceAt,
      outboundEffectId: String(effect._id),
      quantity: valuation.quantity,
    });
    after = result.position;
    const outcome: CandidateReplayOutcome = {
      basisCostedQuantity: result.basis.costedQuantity,
      basisUncostedQuantity: result.basis.uncostedQuantity,
      basisUnresolvedDeficitQuantity: result.basis.unresolvedDeficitQuantity,
      basisVersion: result.basis.basisVersion,
      costedQuantity: result.consumed.costedQuantity,
      costLane: result.treatment.costLane,
      currencyCode: result.basis.currency ?? undefined,
      currencyMinorUnitScale: effect.currencyMinorUnitScale,
      effectId: effect._id,
      knownCostMinor: result.consumed.knownCost,
      knownCostPoolBeforeMinor: result.basis.knownCostPoolBefore,
      occurrenceAt: effect.occurrenceAt,
      operatingDate: effect.operatingDate,
      organizationId: replay.organizationId,
      outcomeKind: "outbound_basis",
      positionId: replay.positionId,
      productSkuId: replay.productSkuId,
      quantity: valuation.quantity,
      replayId: replay._id,
      roundedWeightedAverageUnitCostMinor:
        result.basis.roundedWeightedAverageUnitCost ?? undefined,
      scheduleVersionId: effect.scheduleVersionId,
      storeId: replay.storeId,
      uncostedQuantity: result.consumed.uncostedQuantity,
      unresolvedDeficitQuantity: result.consumed.deficitQuantity,
    };
    if (shouldStageOccurrenceReplayOutcome(effect, outcome)) {
      await stageReplayOutcomeWithCtx(ctx, outcome);
    }
  } else {
    after = applyOccurrenceReplayEffect(before, {
      ...effect,
      businessEventKey: String(effect._id),
    });
  }
  if (after.unresolvedDeficitQuantity > before.unresolvedDeficitQuantity) {
    const quantity =
      after.unresolvedDeficitQuantity - before.unresolvedDeficitQuantity;
    const valuation = effect.replayValuation;
    if (!valuation || valuation.kind !== "outbound") {
      throw new Error("Only outbound replay can create a deficit lot");
    }
    await ctx.db.insert("reportingInventoryOccurrenceReplayLot", {
      costLane:
        valuation.disposition === "merchandise_sale"
          ? "merchandise_cogs"
          : valuation.disposition === "exchange_replacement"
            ? "exchange_merchandise_cogs"
            : valuation.disposition === "service_consumption" ||
                valuation.disposition === "inventory_expense"
              ? "inventory_consumed"
              : valuation.disposition === "damage" ||
                  valuation.disposition === "writeoff"
                ? "inventory_loss"
                : "inventory_adjustment",
      createdAt: Date.now(),
      occurredAt: effect.occurrenceAt,
      organizationId: replay.organizationId,
      outboundEffectId: effect._id,
      positionId: replay.positionId,
      productSkuId: replay.productSkuId,
      remainingQuantity: quantity,
      replayId: replay._id,
      status: "open",
      storeId: replay.storeId,
      updatedAt: Date.now(),
    });
  }
  await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
    ...positionPatch(after),
    cursor: page.continueCursor,
    lastEffectAt: Math.max(replay.lastEffectAt, effect.occurrenceAt),
    processedCount: replay.processedCount + 1,
    status: "running",
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(
    0,
    occurrenceReplayInternal.processOccurrenceReplay,
    { replayId: replay._id },
  );
}

function assertReplayOutcomeIsComplete(
  outcome: Doc<"reportingInventoryOccurrenceReplayOutcome">,
) {
  validateOccurrenceReplayOutcomeQuantities(outcome);
  if (
    outcome.outcomeKind === "outbound_basis" &&
    (outcome.basisVersion === undefined ||
      outcome.basisCostedQuantity === undefined ||
      outcome.basisUncostedQuantity === undefined ||
      outcome.basisUnresolvedDeficitQuantity === undefined ||
      outcome.knownCostPoolBeforeMinor === undefined)
  ) {
    throw new Error("Occurrence replay outbound basis is incomplete");
  }
  if (outcome.costedQuantity > 0 && !outcome.currencyCode) {
    throw new Error("Occurrence replay costed outcome is missing currency");
  }
}

export function occurrenceReplayCoveredRevenueDelta(input: {
  amountMinor?: number;
  costStatus?: "known" | "not_applicable" | "partial" | "unknown";
  hasPriorReplayOutcome?: boolean;
  originalCoveredRevenueMinor?: number;
  priorCostedQuantity: number;
  quantity?: number;
  replayCostedQuantity: number;
}) {
  if (
    input.costStatus === "not_applicable" ||
    !input.amountMinor ||
    !input.quantity
  ) {
    return 0;
  }
  const totalQuantity = Math.abs(input.quantity);
  const amount = Math.abs(input.amountMinor);
  const coverageFor = (costedQuantity: number) =>
    Math.min(
      amount,
      Math.round(
        (amount * Math.min(totalQuantity, costedQuantity)) / totalQuantity,
      ),
    );
  const priorCoverage = input.hasPriorReplayOutcome
    ? coverageFor(input.priorCostedQuantity)
    : input.costStatus === "known"
      ? amount
      : input.costStatus === "partial"
        ? (input.originalCoveredRevenueMinor ??
          coverageFor(input.priorCostedQuantity))
        : 0;
  return coverageFor(input.replayCostedQuantity) - priorCoverage;
}

export function occurrenceReplayKnownCostDelta(input: {
  outcomeKind: "outbound_basis" | "return_reversal";
  priorKnownCostMinor: number;
  replayKnownCostMinor: number;
}) {
  const delta = input.replayKnownCostMinor - input.priorKnownCostMinor;
  return input.outcomeKind === "return_reversal" ? -delta : delta;
}

export function occurrenceReplayFinancialMetricFamily(
  costLane: CandidateReplayOutcome["costLane"],
) {
  if (
    costLane === "merchandise_cogs" ||
    costLane === "exchange_merchandise_cogs"
  ) {
    return "known_cogs" as const;
  }
  if (costLane === "inventory_consumed") {
    return "inventory_consumed" as const;
  }
  return null;
}

export function occurrenceReplayResolutionFactContributesFinancially(
  fact: Pick<
    Doc<"reportingFact">,
    "adjustmentKind" | "inventoryContributionKind"
  >,
) {
  return (
    fact.adjustmentKind === "deficit_cogs_revaluation" ||
    fact.inventoryContributionKind === "inventory_consumed" ||
    fact.inventoryContributionKind === "exchange_replacement_cogs"
  );
}

export function assertOccurrenceReplayOutcomeActivationBound(count: number) {
  if (count > INVENTORY_REPLAY_ATOMIC_OUTCOME_LIMIT) {
    throw new Error(
      "Occurrence replay financial activation exceeds atomic limit",
    );
  }
}

async function applyReplayFinancialOutcomesWithCtx(
  ctx: MutationCtx,
  replay: Doc<"reportingInventoryOccurrenceReplay">,
  outcomes: Doc<"reportingInventoryOccurrenceReplayOutcome">[],
  now: number,
) {
  const createdFactIds: Id<"reportingFact">[] = [];
  for (const outcome of outcomes) {
    assertReplayOutcomeIsComplete(outcome);
    const effect = await ctx.db.get(
      "reportingInventoryEffect",
      outcome.effectId,
    );
    if (
      !effect ||
      effect.organizationId !== replay.organizationId ||
      effect.positionId !== replay.positionId ||
      effect.productSkuId !== replay.productSkuId ||
      effect.storeId !== replay.storeId
    ) {
      throw new Error("Occurrence replay financial effect ownership changed");
    }
    const settledOutcome = await readLatestSettledOutcomeWithCtx(ctx, {
      effectId: effect._id,
      outcomeKind: outcome.outcomeKind,
    });
    const priorOutcome =
      settledOutcome?.status === "applied" ? settledOutcome : null;
    const priorWasWithheld = settledOutcome?.status === "withheld";
    const missingContribution =
      !priorOutcome &&
      (effect.valuationStatus === "rebuild_required" ||
        (outcome.outcomeKind === "outbound_basis"
          ? effect.outboundBasisMinor === undefined
          : effect.cogsReversalKnownMinor === undefined));
    const priorKnownCost = priorWasWithheld
      ? 0
      : (priorOutcome?.knownCostMinor ??
        (outcome.outcomeKind === "outbound_basis"
          ? (effect.outboundBasisMinor ?? 0)
          : (effect.cogsReversalKnownMinor ?? 0)));
    const financialDelta = occurrenceReplayKnownCostDelta({
      outcomeKind: outcome.outcomeKind,
      priorKnownCostMinor: priorKnownCost,
      replayKnownCostMinor: outcome.knownCostMinor,
    });
    const priorCurrency = priorWasWithheld
      ? outcome.currencyCode
      : (priorOutcome?.currencyCode ?? effect.currencyCode);
    if (
      financialDelta !== 0 &&
      priorCurrency &&
      outcome.currencyCode &&
      priorCurrency !== outcome.currencyCode
    ) {
      throw new Error("Occurrence replay cannot net costs across currencies");
    }
    const financialCurrency = outcome.currencyCode ?? priorCurrency;
    if (financialDelta !== 0 && !financialCurrency) {
      throw new Error(
        "Occurrence replay financial correction is missing currency",
      );
    }
    const metricFamily = occurrenceReplayFinancialMetricFamily(
      outcome.costLane,
    );
    const isInventoryConsumed = metricFamily === "inventory_consumed";
    const isExchange = outcome.costLane === "exchange_merchandise_cogs";
    const isMerchandise = outcome.costLane === "merchandise_cogs";
    const contributesFinancially = metricFamily !== null;
    const directSpecialContribution =
      missingContribution &&
      (outcome.outcomeKind === "return_reversal" ||
        isInventoryConsumed ||
        isExchange);
    let coveredRevenueMinor = 0;
    let commerceFact: Doc<"reportingFact"> | undefined;
    if (isMerchandise) {
      const sourceFacts = await ctx.db
        .query("reportingFact")
        .withIndex("by_inventoryEffectId", (query) =>
          query.eq("inventoryEffectId", effect._id),
        )
        .take(20);
      commerceFact = sourceFacts.find(
        (fact) =>
          !fact.businessEventKey.startsWith("occurrence-replay:") &&
          ["correction", "sale", "void"].includes(fact.factType),
      );
      coveredRevenueMinor = occurrenceReplayCoveredRevenueDelta({
        amountMinor: commerceFact?.amountMinor,
        costStatus: commerceFact?.costStatus,
        hasPriorReplayOutcome: Boolean(priorOutcome || priorWasWithheld),
        originalCoveredRevenueMinor: priorOutcome
          ? undefined
          : commerceFact?.coveredRevenueMinor,
        priorCostedQuantity: priorWasWithheld
          ? 0
          : (priorOutcome?.costedQuantity ??
            commerceFact?.cogsKnownQuantity ??
            Math.max(0, -effect.costedQuantityDelta)),
        quantity: commerceFact?.quantity,
        replayCostedQuantity: outcome.costedQuantity,
      });
      const revenueCurrency =
        commerceFact?.revenueCurrencyCode ?? commerceFact?.currencyCode;
      if (
        revenueCurrency &&
        financialCurrency &&
        revenueCurrency !== financialCurrency
      ) {
        throw new Error(
          "Occurrence replay merchandise currencies are incompatible",
        );
      }
    }
    const shouldCreateFact =
      contributesFinancially &&
      Boolean(outcome.operatingDate && outcome.scheduleVersionId) &&
      (directSpecialContribution ||
        financialDelta !== 0 ||
        coveredRevenueMinor !== 0);

    if (shouldCreateFact) {
      const businessEventKey = `occurrence-replay:${replay._id}:${effect._id}:${outcome.outcomeKind}`;
      const existing = await ctx.db
        .query("reportingFact")
        .withIndex("by_storeId_sourceDomain_businessEventKey", (query) =>
          query
            .eq("storeId", replay.storeId)
            .eq("sourceDomain", "inventory")
            .eq("businessEventKey", businessEventKey),
        )
        .first();
      if (existing) {
        if (existing.status !== "canonical") {
          throw new Error("Occurrence replay financial fact is not canonical");
        }
        createdFactIds.push(existing._id);
      } else {
        let factType: "inventory_issue" | "post_close_adjustment" | "return" =
          "post_close_adjustment";
        let inventoryContributionKind:
          | "exchange_replacement_cogs"
          | "inventory_consumed"
          | "inventory_consumed_reversal"
          | "sellable_return_cogs_reversal"
          | undefined;
        let factQuantity = outcome.quantity;
        let factKnownCost = financialDelta;
        if (directSpecialContribution) {
          factKnownCost =
            outcome.outcomeKind === "return_reversal"
              ? -Math.abs(outcome.knownCostMinor)
              : Math.abs(outcome.knownCostMinor);
          if (outcome.outcomeKind === "return_reversal") {
            factQuantity = -Math.abs(outcome.quantity);
            if (isInventoryConsumed) {
              factType = "inventory_issue";
              inventoryContributionKind = "inventory_consumed_reversal";
            } else {
              factType = "return";
              inventoryContributionKind = "sellable_return_cogs_reversal";
            }
          } else if (isInventoryConsumed) {
            factType = "inventory_issue";
            inventoryContributionKind = "inventory_consumed";
          } else if (isExchange) {
            factType = "inventory_issue";
            inventoryContributionKind = "exchange_replacement_cogs";
          }
        } else if (isInventoryConsumed) {
          factType = "inventory_issue";
          factQuantity = 0;
          inventoryContributionKind =
            financialDelta < 0
              ? "inventory_consumed_reversal"
              : "inventory_consumed";
          factKnownCost = Math.abs(financialDelta);
        }
        const targetHasKnownCost =
          outcome.costedQuantity > 0 && outcome.currencyCode !== undefined;
        const targetCostStatus = !targetHasKnownCost
          ? ("unknown" as const)
          : outcome.uncostedQuantity + outcome.unresolvedDeficitQuantity > 0
            ? ("partial" as const)
            : ("known" as const);
        const factHasKnownCost = directSpecialContribution
          ? targetHasKnownCost
          : financialDelta !== 0;
        const costStatus = directSpecialContribution
          ? targetCostStatus
          : ("known" as const);
        const factId = await ctx.db.insert("reportingFact", {
          acceptedAt: now,
          ...(factType === "post_close_adjustment"
            ? {
                adjustmentKind: "deficit_cogs_revaluation" as const,
                coveredRevenueMinor,
              }
            : {}),
          amountMinor: 0,
          businessEventKey,
          ...(factHasKnownCost
            ? {
                cogsKnownMinor: factKnownCost,
                valuationCurrencyCode: financialCurrency,
                valuationCurrencyMinorUnitScale:
                  outcome.currencyMinorUnitScale ?? 2,
              }
            : {}),
          completeness: targetCostStatus === "known" ? "complete" : "partial",
          contentFingerprint: `occurrence-replay-financial:v1:${replay._id}:${effect._id}:${outcome.outcomeKind}:${factKnownCost}:${factQuantity}`,
          costStatus,
          createdAt: now,
          currencyCode: financialCurrency,
          currencyMinorUnitScale: outcome.currencyMinorUnitScale,
          factContractVersion: 1,
          factType,
          inventoryContributionKind,
          inventoryEffectId: effect._id,
          limitingReason: targetCostStatus === "known" ? undefined : "uncosted",
          linkedBusinessEventKey: effect.businessEventKey,
          metricContractVersion: 1,
          occurrenceAt: outcome.occurrenceAt,
          operatingDate: outcome.operatingDate!,
          organizationId: outcome.organizationId,
          productSkuId: outcome.productSkuId,
          quantity: factQuantity,
          revenueCurrencyCode:
            commerceFact?.revenueCurrencyCode ?? commerceFact?.currencyCode,
          revenueCurrencyMinorUnitScale:
            commerceFact?.revenueCurrencyMinorUnitScale ??
            commerceFact?.currencyMinorUnitScale,
          recognitionAt: outcome.occurrenceAt,
          scheduleVersionId: outcome.scheduleVersionId!,
          sourceDomain: "inventory",
          status: "canonical",
          storeId: outcome.storeId,
        });
        for (const reference of [
          {
            relation: "owns" as const,
            sourceId: String(replay._id),
            sourceType: "reporting_inventory_occurrence_replay",
          },
          {
            relation: "corrects" as const,
            sourceId: String(effect._id),
            sourceType: "reporting_inventory_effect",
          },
        ]) {
          await ctx.db.insert("reportingFactSourceReference", {
            createdAt: now,
            factId,
            ...reference,
            storeId: replay.storeId,
          });
        }
        const fact = await ctx.db.get("reportingFact", factId);
        if (!fact)
          throw new Error("Occurrence replay financial fact disappeared");
        await recordFactSkuEvidenceWithCtx(ctx, fact);
        createdFactIds.push(factId);
      }
    }

    await ctx.db.patch(
      "reportingInventoryOccurrenceReplayOutcome",
      outcome._id,
      { appliedAt: now, settledAt: now, status: "applied" },
    );
  }
  if (createdFactIds.length > 0) {
    await scheduleFactProjectionBatchWithCtx(ctx, createdFactIds);
  }
}

async function withholdPostBaselineResolutionBatch(
  ctx: MutationCtx,
  replay: Doc<"reportingInventoryOccurrenceReplay">,
) {
  const baseline = await ctx.db.get(
    "reportingCutoverBaseline",
    replay.baselineId,
  );
  if (!baseline) throw new Error("Occurrence replay baseline disappeared");
  const page = await ctx.db
    .query("reportingInventoryEffect")
    .withIndex("by_positionId_effectType", (query) =>
      query
        .eq("positionId", replay.positionId)
        .eq("effectType", "deficit_resolution")
        .gt("_creationTime", baseline._creationTime)
        .lte("_creationTime", replay.frozenWatermark),
    )
    .paginate({
      cursor: replay.withholdingResolutionCursor ?? null,
      numItems: INVENTORY_OCCURRENCE_REPLAY_PAGE_SIZE,
    });
  const now = Date.now();
  const createdFactIds: Id<"reportingFact">[] = [];
  for (const effect of page.page) {
    const sourceFact = await ctx.db
      .query("reportingFact")
      .withIndex("by_inventoryEffectId", (query) =>
        query.eq("inventoryEffectId", effect._id),
      )
      .filter((query) => query.eq(query.field("status"), "canonical"))
      .first();
    if (
      !sourceFact ||
      sourceFact.businessEventKey.startsWith("occurrence-replay") ||
      !occurrenceReplayResolutionFactContributesFinancially(sourceFact)
    ) {
      continue;
    }
    const businessEventKey = `occurrence-replay-withhold:${replay._id}:resolution:${effect._id}:${sourceFact._id}`;
    const existing = await ctx.db
      .query("reportingFact")
      .withIndex("by_storeId_sourceDomain_businessEventKey", (query) =>
        query
          .eq("storeId", replay.storeId)
          .eq("sourceDomain", "inventory")
          .eq("businessEventKey", businessEventKey),
      )
      .first();
    if (existing) {
      createdFactIds.push(existing._id);
      continue;
    }
    const inventoryConsumed =
      sourceFact.inventoryContributionKind === "inventory_consumed";
    const factId = await ctx.db.insert("reportingFact", {
      acceptedAt: now,
      ...(inventoryConsumed
        ? {}
        : {
            adjustmentKind: "deficit_cogs_revaluation" as const,
            coveredRevenueMinor: -(sourceFact.coveredRevenueMinor ?? 0),
          }),
      amountMinor: 0,
      businessEventKey,
      cogsKnownMinor: inventoryConsumed
        ? Math.abs(sourceFact.cogsKnownMinor ?? 0)
        : -(sourceFact.cogsKnownMinor ?? 0),
      completeness: "partial",
      contentFingerprint: `occurrence-replay-resolution-withhold:v1:${replay._id}:${effect._id}:${sourceFact._id}`,
      costStatus: "known",
      createdAt: now,
      currencyCode: sourceFact.valuationCurrencyCode ?? sourceFact.currencyCode,
      currencyMinorUnitScale:
        sourceFact.valuationCurrencyMinorUnitScale ??
        sourceFact.currencyMinorUnitScale,
      factContractVersion: 1,
      factType: inventoryConsumed ? "inventory_issue" : "post_close_adjustment",
      inventoryContributionKind: inventoryConsumed
        ? "inventory_consumed_reversal"
        : undefined,
      inventoryEffectId: effect._id,
      limitingReason: "uncosted",
      linkedBusinessEventKey: effect.businessEventKey,
      metricContractVersion: 1,
      occurrenceAt: sourceFact.occurrenceAt,
      operatingDate: sourceFact.operatingDate,
      organizationId: replay.organizationId,
      productSkuId: replay.productSkuId,
      quantity: 0,
      recognitionAt: sourceFact.recognitionAt,
      revenueCurrencyCode:
        sourceFact.revenueCurrencyCode ?? sourceFact.currencyCode,
      revenueCurrencyMinorUnitScale:
        sourceFact.revenueCurrencyMinorUnitScale ??
        sourceFact.currencyMinorUnitScale,
      scheduleVersionId: sourceFact.scheduleVersionId,
      sourceDomain: "inventory",
      status: "canonical",
      storeId: replay.storeId,
      valuationCurrencyCode:
        sourceFact.valuationCurrencyCode ?? sourceFact.currencyCode,
      valuationCurrencyMinorUnitScale:
        sourceFact.valuationCurrencyMinorUnitScale ??
        sourceFact.currencyMinorUnitScale,
    });
    for (const [sourceId, relation] of [
      [String(replay._id), "owns"],
      [String(sourceFact._id), "corrects"],
    ] as const) {
      await ctx.db.insert("reportingFactSourceReference", {
        createdAt: now,
        factId,
        relation,
        sourceId,
        sourceType: "reporting_inventory_occurrence_replay",
        storeId: replay.storeId,
      });
    }
    const fact = await ctx.db.get("reportingFact", factId);
    if (!fact) throw new Error("Resolution withholding fact disappeared");
    await recordFactSkuEvidenceWithCtx(ctx, fact);
    createdFactIds.push(factId);
  }
  if (createdFactIds.length > 0) {
    await scheduleFactProjectionBatchWithCtx(ctx, createdFactIds);
  }
  await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
    withholdingResolutionCursor: page.continueCursor,
    updatedAt: now,
  });
  if (!page.isDone) {
    await scheduleReportingWorkBestEffort(
      ctx,
      occurrenceReplayInternal.processOccurrenceReplay,
      { replayId: replay._id },
    );
  }
  return page.isDone;
}

export async function withholdReplayFinancialOutcomeBatch(
  ctx: MutationCtx,
  replay: Doc<"reportingInventoryOccurrenceReplay">,
) {
  if (replay.status === "failed" || replay.status === "completed") return;
  const outcomes = await ctx.db
    .query("reportingInventoryOccurrenceReplayOutcome")
    .withIndex("by_replayId_status", (query) =>
      query.eq("replayId", replay._id).eq("status", "candidate"),
    )
    .take(INVENTORY_OCCURRENCE_REPLAY_PAGE_SIZE);
  const now = Date.now();
  if (outcomes.length === 0) {
    if (!(await withholdPostBaselineResolutionBatch(ctx, replay))) return;
    const candidateLedger = await ctx.db.get(
      "reportingInventoryDeficitLedger",
      replay.candidateLedgerId,
    );
    if (candidateLedger?.status === "candidate") {
      await ctx.db.patch(
        "reportingInventoryDeficitLedger",
        candidateLedger._id,
        { status: "abandoned" },
      );
    }
    await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
      attemptCount: replay.attemptCount + 1,
      latestFailureAt: now,
      latestFailureCode: "financial_outcomes_withheld",
      status: "failed",
      updatedAt: now,
    });
    return;
  }

  const createdFactIds: Id<"reportingFact">[] = [];
  for (const outcome of outcomes) {
    assertReplayOutcomeIsComplete(outcome);
    const effect = await ctx.db.get(
      "reportingInventoryEffect",
      outcome.effectId,
    );
    if (
      !effect ||
      effect.organizationId !== replay.organizationId ||
      effect.positionId !== replay.positionId ||
      effect.productSkuId !== replay.productSkuId ||
      effect.storeId !== replay.storeId
    ) {
      throw new Error("Occurrence replay withholding effect ownership changed");
    }
    const settledOutcome = await readLatestSettledOutcomeWithCtx(ctx, {
      effectId: effect._id,
      outcomeKind: outcome.outcomeKind,
    });
    const priorApplied =
      settledOutcome?.status === "applied" ? settledOutcome : null;
    const alreadyWithheld = settledOutcome?.status === "withheld";
    const priorKnownCost = alreadyWithheld
      ? 0
      : (priorApplied?.knownCostMinor ??
        (outcome.outcomeKind === "outbound_basis"
          ? (effect.outboundBasisMinor ?? 0)
          : (effect.cogsReversalKnownMinor ?? 0)));
    const priorCostedQuantity = alreadyWithheld
      ? 0
      : (priorApplied?.costedQuantity ??
        Math.max(0, -effect.costedQuantityDelta));
    const priorCurrency = priorApplied?.currencyCode ?? effect.currencyCode;
    const priorCurrencyMinorUnitScale =
      priorApplied?.currencyMinorUnitScale ?? effect.currencyMinorUnitScale;
    const metricFamily = occurrenceReplayFinancialMetricFamily(
      outcome.costLane,
    );
    let coveredRevenueMinor = 0;
    let commerceFact: Doc<"reportingFact"> | undefined;
    if (
      metricFamily === "known_cogs" &&
      outcome.costLane === "merchandise_cogs"
    ) {
      const sourceFacts = await ctx.db
        .query("reportingFact")
        .withIndex("by_inventoryEffectId", (query) =>
          query.eq("inventoryEffectId", effect._id),
        )
        .take(20);
      commerceFact = sourceFacts.find(
        (fact) =>
          !fact.businessEventKey.startsWith("occurrence-replay:") &&
          ["correction", "sale", "void"].includes(fact.factType),
      );
      coveredRevenueMinor = alreadyWithheld
        ? 0
        : occurrenceReplayCoveredRevenueDelta({
            amountMinor: commerceFact?.amountMinor,
            costStatus: commerceFact?.costStatus,
            hasPriorReplayOutcome: Boolean(priorApplied),
            originalCoveredRevenueMinor: priorApplied
              ? undefined
              : commerceFact?.coveredRevenueMinor,
            priorCostedQuantity,
            quantity: commerceFact?.quantity,
            replayCostedQuantity: 0,
          });
      const revenueCurrency =
        commerceFact?.revenueCurrencyCode ?? commerceFact?.currencyCode;
      if (
        revenueCurrency &&
        priorCurrency &&
        revenueCurrency !== priorCurrency
      ) {
        coveredRevenueMinor = 0;
      }
    }
    const cogsDelta =
      outcome.outcomeKind === "return_reversal"
        ? priorKnownCost
        : -priorKnownCost;
    if (
      metricFamily &&
      (cogsDelta !== 0 || coveredRevenueMinor !== 0) &&
      outcome.operatingDate &&
      outcome.scheduleVersionId
    ) {
      const businessEventKey = `occurrence-replay-withhold:${replay._id}:${effect._id}:${outcome.outcomeKind}`;
      const existing = await ctx.db
        .query("reportingFact")
        .withIndex("by_storeId_sourceDomain_businessEventKey", (query) =>
          query
            .eq("storeId", replay.storeId)
            .eq("sourceDomain", "inventory")
            .eq("businessEventKey", businessEventKey),
        )
        .first();
      if (existing) {
        createdFactIds.push(existing._id);
      } else {
        const inventoryConsumed = metricFamily === "inventory_consumed";
        const factId = await ctx.db.insert("reportingFact", {
          acceptedAt: now,
          ...(inventoryConsumed
            ? {}
            : {
                adjustmentKind: "deficit_cogs_revaluation" as const,
                coveredRevenueMinor,
              }),
          amountMinor: 0,
          businessEventKey,
          cogsKnownMinor: inventoryConsumed ? Math.abs(cogsDelta) : cogsDelta,
          completeness: "partial",
          contentFingerprint: `occurrence-replay-withhold:v1:${replay._id}:${effect._id}:${outcome.outcomeKind}:${cogsDelta}:${coveredRevenueMinor}`,
          costStatus: "known",
          createdAt: now,
          currencyCode: priorCurrency,
          currencyMinorUnitScale: priorCurrencyMinorUnitScale,
          factContractVersion: 1,
          factType: inventoryConsumed
            ? "inventory_issue"
            : "post_close_adjustment",
          inventoryContributionKind: inventoryConsumed
            ? outcome.outcomeKind === "return_reversal"
              ? "inventory_consumed"
              : "inventory_consumed_reversal"
            : undefined,
          inventoryEffectId: effect._id,
          limitingReason: "uncosted",
          linkedBusinessEventKey: effect.businessEventKey,
          metricContractVersion: 1,
          occurrenceAt: outcome.occurrenceAt,
          operatingDate: outcome.operatingDate,
          organizationId: outcome.organizationId,
          productSkuId: outcome.productSkuId,
          quantity: 0,
          recognitionAt: outcome.occurrenceAt,
          revenueCurrencyCode:
            commerceFact?.revenueCurrencyCode ?? commerceFact?.currencyCode,
          revenueCurrencyMinorUnitScale:
            commerceFact?.revenueCurrencyMinorUnitScale ??
            commerceFact?.currencyMinorUnitScale,
          scheduleVersionId: outcome.scheduleVersionId,
          sourceDomain: "inventory",
          status: "canonical",
          storeId: outcome.storeId,
          valuationCurrencyCode: priorCurrency,
          valuationCurrencyMinorUnitScale: priorCurrencyMinorUnitScale ?? 2,
        });
        for (const reference of [
          {
            relation: "owns" as const,
            sourceId: String(replay._id),
            sourceType: "reporting_inventory_occurrence_replay",
          },
          {
            relation: "corrects" as const,
            sourceId: String(effect._id),
            sourceType: "reporting_inventory_effect",
          },
        ]) {
          await ctx.db.insert("reportingFactSourceReference", {
            createdAt: now,
            factId,
            ...reference,
            storeId: replay.storeId,
          });
        }
        const fact = await ctx.db.get("reportingFact", factId);
        if (!fact)
          throw new Error("Occurrence replay withholding fact disappeared");
        await recordFactSkuEvidenceWithCtx(ctx, fact);
        createdFactIds.push(factId);
      }
    }
    await ctx.db.patch(
      "reportingInventoryOccurrenceReplayOutcome",
      outcome._id,
      { settledAt: now, status: "withheld", withheldAt: now },
    );
  }
  if (createdFactIds.length > 0) {
    await scheduleFactProjectionBatchWithCtx(ctx, createdFactIds);
  }
  await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
    phase: "withholding_financial",
    status: "running",
    updatedAt: now,
  });
  await scheduleReportingWorkBestEffort(
    ctx,
    occurrenceReplayInternal.processOccurrenceReplay,
    { replayId: replay._id },
  );
}

export async function applyCandidateLotBatch(
  ctx: MutationCtx,
  replay: Doc<"reportingInventoryOccurrenceReplay">,
) {
  const candidates = await ctx.db
    .query("reportingInventoryOccurrenceReplayLot")
    .withIndex("by_replayId_appliedAt", (query) =>
      query.eq("replayId", replay._id).eq("appliedAt", undefined),
    )
    .take(INVENTORY_OCCURRENCE_REPLAY_PAGE_SIZE);
  const now = Date.now();
  for (const candidate of candidates) {
    if (candidate.status === "open") {
      await ctx.db.insert("reportingInventoryDeficitLot", {
        costLane: candidate.costLane,
        createdAt: now,
        ledgerId: replay.candidateLedgerId,
        occurredAt: candidate.occurredAt,
        organizationId: candidate.organizationId,
        outboundEffectId: candidate.outboundEffectId,
        positionId: candidate.positionId,
        productSkuId: candidate.productSkuId,
        remainingQuantity: candidate.remainingQuantity,
        status: "open",
        storeId: candidate.storeId,
        updatedAt: now,
      });
    }
    await ctx.db.patch("reportingInventoryOccurrenceReplayLot", candidate._id, {
      appliedAt: now,
      updatedAt: now,
    });
  }
  if (candidates.length === INVENTORY_OCCURRENCE_REPLAY_PAGE_SIZE) {
    await ctx.scheduler.runAfter(
      0,
      occurrenceReplayInternal.processOccurrenceReplay,
      { replayId: replay._id },
    );
    return;
  }
  const laterRevision = await ctx.db
    .query("reportingInventoryPositionRevision")
    .withIndex("by_positionId", (query) =>
      query
        .eq("positionId", replay.positionId)
        .gt("_creationTime", replay.frozenWatermark),
    )
    .first();
  if (laterRevision) {
    await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
      phase: "withholding_financial",
      status: "running",
      updatedAt: now,
    });
    await scheduleReportingWorkBestEffort(
      ctx,
      occurrenceReplayInternal.processOccurrenceReplay,
      { replayId: replay._id },
    );
    return;
  }
  const [baseline, productSku, currentPosition] = await Promise.all([
    ctx.db.get("reportingCutoverBaseline", replay.baselineId),
    ctx.db.get("productSku", replay.productSkuId),
    ctx.db.get("reportingInventoryPosition", replay.positionId),
  ]);
  if (!baseline || !productSku || !currentPosition) {
    throw new Error("Occurrence replay target disappeared");
  }
  const currentLedger = currentPosition.deficitLedgerId
    ? await ctx.db.get(
        "reportingInventoryDeficitLedger",
        currentPosition.deficitLedgerId,
      )
    : null;
  const candidateLedger = await ctx.db.get(
    "reportingInventoryDeficitLedger",
    replay.candidateLedgerId,
  );
  if (
    !currentLedger ||
    currentLedger._id !== replay.sourceLedgerId ||
    currentLedger.status !== "active" ||
    !candidateLedger ||
    candidateLedger.status !== "candidate"
  ) {
    throw new Error("Occurrence replay deficit ledger authority changed");
  }
  const postBaselineResolution = await ctx.db
    .query("reportingInventoryEffect")
    .withIndex("by_positionId_effectType", (query) =>
      query
        .eq("positionId", replay.positionId)
        .eq("effectType", "deficit_resolution")
        .gt("_creationTime", baseline._creationTime)
        .lte("_creationTime", replay.frozenWatermark),
    )
    .first();
  if (postBaselineResolution) {
    await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
      phase: "withholding_financial",
      status: "running",
      updatedAt: now,
    });
    await scheduleReportingWorkBestEffort(
      ctx,
      occurrenceReplayInternal.processOccurrenceReplay,
      { replayId: replay._id },
    );
    return;
  }
  const outcomes = await ctx.db
    .query("reportingInventoryOccurrenceReplayOutcome")
    .withIndex("by_replayId_status", (query) =>
      query.eq("replayId", replay._id).eq("status", "candidate"),
    )
    .take(INVENTORY_REPLAY_ATOMIC_OUTCOME_LIMIT + 1);
  if (outcomes.length > INVENTORY_REPLAY_ATOMIC_OUTCOME_LIMIT) {
    await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
      phase: "withholding_financial",
      status: "running",
      updatedAt: now,
    });
    await scheduleReportingWorkBestEffort(
      ctx,
      occurrenceReplayInternal.processOccurrenceReplay,
      { replayId: replay._id },
    );
    return;
  }
  const [activeOpenLots, candidateOpenLots] = await Promise.all([
    ctx.db
      .query("reportingInventoryDeficitLot")
      .withIndex("by_ledgerId_status_occurredAt_outboundEffectId", (query) =>
        query.eq("ledgerId", replay.sourceLedgerId).eq("status", "open"),
      )
      .take(INVENTORY_REPLAY_OWNERSHIP_COMPARE_LIMIT + 1),
    ctx.db
      .query("reportingInventoryDeficitLot")
      .withIndex("by_ledgerId_status_occurredAt_outboundEffectId", (query) =>
        query.eq("ledgerId", replay.candidateLedgerId).eq("status", "open"),
      )
      .take(INVENTORY_REPLAY_OWNERSHIP_COMPARE_LIMIT + 1),
  ]);
  if (
    activeOpenLots.length > INVENTORY_REPLAY_OWNERSHIP_COMPARE_LIMIT ||
    candidateOpenLots.length > INVENTORY_REPLAY_OWNERSHIP_COMPARE_LIMIT
  ) {
    throw new Error("Occurrence replay deficit ownership exceeds atomic limit");
  }
  const changedOutboundEffectIds = occurrenceReplayChangedDeficitOwners(
    activeOpenLots,
    candidateOpenLots,
  );
  const materiallyResolvedOutboundEffectIds: string[] = [];
  for (const outboundEffectId of changedOutboundEffectIds) {
    const resolution = await ctx.db
      .query("reportingInventoryEffect")
      .withIndex("by_linkedOutboundEffectId_effectType", (query) =>
        query
          .eq(
            "linkedOutboundEffectId",
            outboundEffectId as Id<"reportingInventoryEffect">,
          )
          .eq("effectType", "deficit_resolution"),
      )
      .first();
    if (resolution) {
      materiallyResolvedOutboundEffectIds.push(outboundEffectId);
    }
  }
  if (
    occurrenceReplayOwnershipConflictRequiresFailClose(
      changedOutboundEffectIds,
      materiallyResolvedOutboundEffectIds,
    )
  ) {
    throw new Error(
      "Occurrence replay changes deficit ownership and requires financial reconciliation",
    );
  }
  const position = replayPosition(replay);
  if (
    position.costedQuantity + position.uncostedQuantity !==
      productSku.inventoryCount ||
    currentPosition.onHandQuantity !== productSku.inventoryCount ||
    currentPosition.sellableQuantity !== productSku.quantityAvailable
  ) {
    throw new Error(
      "Occurrence replay does not reconcile to operational stock",
    );
  }
  await applyReplayFinancialOutcomesWithCtx(ctx, replay, outcomes, now);
  await ctx.db.patch("reportingInventoryPosition", currentPosition._id, {
    ...positionPatch(position),
    deficitLedgerId: replay.candidateLedgerId,
    lastEffectAt: replay.lastEffectAt,
    updatedAt: now,
    valuationPendingFrom: undefined,
    valuationStatus: "current",
  });
  await ctx.db.patch("reportingInventoryDeficitLedger", currentLedger._id, {
    status: "superseded",
    supersededAt: now,
  });
  await ctx.db.patch(
    "reportingInventoryDeficitLedger",
    replay.candidateLedgerId,
    { activatedAt: now, status: "active" },
  );
  await recordInventoryPositionRevisionWithCtx(ctx, {
    organizationId: replay.organizationId,
    positionId: replay.positionId,
    productSkuId: replay.productSkuId,
    recordedAt: now,
    revisionKind: "rebuild_applied",
    storeId: replay.storeId,
  });
  await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
    attemptCount: replay.attemptCount + 1,
    completedAt: now,
    status: "completed",
    updatedAt: now,
  });
}

export const processOccurrenceReplayMutation = internalMutation({
  args: { replayId: v.id("reportingInventoryOccurrenceReplay") },
  handler: async (ctx, args) => {
    const replay = await ctx.db.get(
      "reportingInventoryOccurrenceReplay",
      args.replayId,
    );
    if (
      !replay ||
      replay.status === "completed" ||
      replay.status === "failed"
    ) {
      return;
    }
    const unresolvedWork = await Promise.all(
      (["pending", "running", "failed"] as const).map((status) =>
        ctx.db
          .query("reportingInventoryDeficitResolutionWork")
          .withIndex("by_ledgerId_status_updatedAt", (query) =>
            query.eq("ledgerId", replay.sourceLedgerId).eq("status", status),
          )
          .first(),
      ),
    );
    if (unresolvedWork.some(Boolean)) {
      await ctx.scheduler.runAfter(
        0,
        (internal as any).reporting.inventory.deficitResolutionWork
          .resumeDeficitResolutionWorkForStore,
        { storeId: replay.storeId },
      );
      await ctx.scheduler.runAfter(
        1_000,
        occurrenceReplayInternal.processOccurrenceReplay,
        { replayId: replay._id },
      );
      return;
    }
    if (replay.phase === "seeding") return processSeedBatch(ctx, replay);
    if (replay.phase === "replaying") return beginOrApplyEffect(ctx, replay);
    if (replay.phase === "withholding_financial") {
      return withholdReplayFinancialOutcomeBatch(ctx, replay);
    }
    return applyCandidateLotBatch(ctx, replay);
  },
});

export const recordOccurrenceReplayFailure = internalMutation({
  args: {
    replayId: v.id("reportingInventoryOccurrenceReplay"),
    safeCode: v.string(),
  },
  handler: async (ctx, args) => {
    const replay = await ctx.db.get(
      "reportingInventoryOccurrenceReplay",
      args.replayId,
    );
    if (!replay || replay.status === "completed") return;
    const now = Date.now();
    const candidateOutcome = await ctx.db
      .query("reportingInventoryOccurrenceReplayOutcome")
      .withIndex("by_replayId_status", (query) =>
        query.eq("replayId", replay._id).eq("status", "candidate"),
      )
      .first();
    if (replay.phase === "withholding_financial" || candidateOutcome) {
      await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
        attemptCount: replay.attemptCount + 1,
        latestFailureAt: now,
        latestFailureCode: args.safeCode,
        phase: "withholding_financial",
        status: "running",
        updatedAt: now,
      });
      await scheduleReportingWorkBestEffort(
        ctx,
        occurrenceReplayInternal.processOccurrenceReplay,
        { replayId: replay._id },
      );
      return;
    }
    const candidateLedger = await ctx.db.get(
      "reportingInventoryDeficitLedger",
      replay.candidateLedgerId,
    );
    if (
      candidateLedger?.replayId === replay._id &&
      candidateLedger.status === "candidate"
    ) {
      await ctx.db.patch(
        "reportingInventoryDeficitLedger",
        candidateLedger._id,
        { status: "abandoned" },
      );
    }
    await ctx.db.patch("reportingInventoryOccurrenceReplay", replay._id, {
      attemptCount: replay.attemptCount + 1,
      latestFailureAt: now,
      latestFailureCode: args.safeCode,
      status: "failed",
      updatedAt: now,
    });
  },
});

export const processOccurrenceReplay = internalAction({
  args: { replayId: v.id("reportingInventoryOccurrenceReplay") },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(
        occurrenceReplayInternal.processOccurrenceReplayMutation,
        args,
      );
    } catch {
      await ctx.runMutation(
        occurrenceReplayInternal.recordOccurrenceReplayFailure,
        {
          replayId: args.replayId,
          safeCode: "occurrence_replay_worker_failed",
        },
      );
    }
  },
});
