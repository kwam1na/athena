import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import {
  applySkuValuationBasisCompensationWithCtx,
  applySkuValuationCorrectionWithCtx,
} from "../reporting/inventory/effects";
import {
  canonicalizeCostOverlayLineages,
  frozenCostOverlayLineagesMatch,
  MAX_FROZEN_LINEAGES_PER_SKU,
  readCostOverlaySkuLineagesWithCtx,
  type FrozenInventoryImportLineage,
} from "./inventoryImportCostOverlayLineage";
import { upsertProductSkuSearchProjection } from "./skuSearch";

const WORK_BATCH_SIZE = 1;

type WorkDirection = "apply" | "undo";

export function assertCostOverlayWorkFence(args: {
  actualEpoch: number;
  actualStatus: string;
  direction: WorkDirection;
  expectedEpoch: number;
}) {
  const expectedStatus = args.direction === "apply" ? "applying" : "undoing";
  if (
    args.actualEpoch !== args.expectedEpoch ||
    args.actualStatus !== expectedStatus
  ) {
    throw new Error("Cost overlay work checkpoint is stale.");
  }
}

export function isSelectedCostOverlayDecision(decision: string) {
  return (
    decision === "selected_missing_cost" || decision === "overwrite_selected"
  );
}

export function nextCostOverlayTerminalStatus(args: {
  direction: WorkDirection;
  exceptionCount: number;
}) {
  if (args.direction === "apply") {
    return args.exceptionCount > 0 ? "applied_with_exceptions" : "applied";
  }
  return args.exceptionCount > 0 ? "undone_with_exceptions" : "undone";
}

export function rollCostOverlayManifestDigest(
  priorDigest: string,
  entry: string,
) {
  let hash = Number.parseInt(priorDigest || "811c9dc5", 16) >>> 0;
  for (let index = 0; index < entry.length; index += 1) {
    hash ^= entry.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function rowFrozenLineages(
  row: Doc<"inventoryImportCostOverlayRow">,
): FrozenInventoryImportLineage[] {
  return (
    (
      row as Doc<"inventoryImportCostOverlayRow"> & {
        frozenLineages?: FrozenInventoryImportLineage[];
      }
    ).frozenLineages ?? []
  );
}

function lineageDigest(lineages: FrozenInventoryImportLineage[]) {
  return rollCostOverlayManifestDigest(
    "",
    JSON.stringify(canonicalizeCostOverlayLineages(lineages)),
  );
}

function actorForDirection(
  run: Doc<"inventoryImportCostOverlayRun">,
  direction: WorkDirection,
) {
  const frozenActors = run as Doc<"inventoryImportCostOverlayRun"> & {
    applyConfirmedByUserId?: Id<"athenaUser">;
    undoRequestedByUserId?: Id<"athenaUser">;
  };
  return (
    (direction === "apply"
      ? frozenActors.applyConfirmedByUserId
      : frozenActors.undoRequestedByUserId) ?? run.createdByUserId
  );
}

function safeAdd(left: number, right: number) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return null;
  const result = BigInt(left) + BigInt(right);
  return result > BigInt(Number.MAX_SAFE_INTEGER) ||
    result < BigInt(Number.MIN_SAFE_INTEGER)
    ? null
    : Number(result);
}

function safeMultiply(left: number, right: number) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return null;
  const result = BigInt(left) * BigInt(right);
  return result > BigInt(Number.MAX_SAFE_INTEGER) ||
    result < BigInt(Number.MIN_SAFE_INTEGER)
    ? null
    : Number(result);
}

export function costOverlayPreparedImpact(
  row: Pick<
    Doc<"inventoryImportCostOverlayRow">,
    "normalizedCostMinor" | "preInventoryCount" | "preKnownCostPoolMinor"
  >,
) {
  if (
    !Number.isSafeInteger(row.preKnownCostPoolMinor) ||
    row.preKnownCostPoolMinor < 0 ||
    row.normalizedCostMinor === undefined
  ) {
    return null;
  }
  const afterMinor = safeMultiply(
    row.preInventoryCount,
    row.normalizedCostMinor,
  );
  return afterMinor === null
    ? null
    : { afterMinor, beforeMinor: row.preKnownCostPoolMinor };
}

export function mergeLargestCostOverlayImpacts(
  current: Array<{
    productName: string;
    sku?: string;
    beforeMinor: number;
    afterMinor: number;
    deltaMinor: number;
  }>,
  candidate: {
    productName: string;
    sku?: string;
    beforeMinor: number;
    afterMinor: number;
    deltaMinor: number;
  },
) {
  return [...current, candidate]
    .sort(
      (left, right) =>
        Math.abs(right.deltaMinor) - Math.abs(left.deltaMinor) ||
        left.productName.localeCompare(right.productName),
    )
    .slice(0, 5);
}

function isExpectedValuationDomainError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /(?:must (?:be|remain) (?:a )?(?:nonnegative )?safe integer|SKU valuation correction values are invalid|Selected SKU could not be found for this store|SKU product ownership does not match the selected store|valuation position could not be initialized)/i.test(
    error.message,
  );
}

function scheduleWork(
  ctx: MutationCtx,
  args: {
    direction: WorkDirection;
    expectedEpoch: number;
    runId: Id<"inventoryImportCostOverlayRun">;
  },
) {
  return ctx.scheduler.runAfter(
    0,
    makeFunctionReference<
      "mutation",
      {
        runId: Id<"inventoryImportCostOverlayRun">;
        expectedEpoch: number;
      }
    >(
      `inventory/inventoryImportCostOverlayWork:${
        args.direction === "apply"
          ? "processCostOverlayApplyBatch"
          : "processCostOverlayUndoBatch"
      }`,
    ),
    {
      runId: args.runId,
      expectedEpoch: args.expectedEpoch,
    },
  );
}

type WorkReadCtx = Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">;

async function getPosition(
  ctx: WorkReadCtx,
  storeId: Id<"store">,
  productSkuId: Id<"productSku">,
) {
  return ctx.db
    .query("reportingInventoryPosition")
    .withIndex("by_storeId_productSkuId", (q) =>
      q.eq("storeId", storeId).eq("productSkuId", productSkuId),
    )
    .unique();
}

function valuationPositionQuantityMatchesInventoryCount(
  position: Doc<"reportingInventoryPosition">,
  inventoryCount: number,
) {
  return (
    safeAdd(position.costedQuantity, position.uncostedQuantity) ===
    inventoryCount
  );
}

function positionMatchesPreState(
  row: Doc<"inventoryImportCostOverlayRow">,
  position: Doc<"reportingInventoryPosition"> | null,
) {
  if (!position) return row.prePositionVersion === undefined;
  return (
    position.version === row.prePositionVersion &&
    position.costedQuantity === row.preCostedQuantity &&
    position.uncostedQuantity === row.preUncostedQuantity &&
    position.knownCostPoolMinor === row.preKnownCostPoolMinor &&
    position.currencyCode === row.preCurrencyCode &&
    position.currencyMinorUnitScale === row.preCurrencyMinorUnitScale &&
    position.unresolvedDeficitQuantity === 0
  );
}

function positionMatchesPostState(
  row: Doc<"inventoryImportCostOverlayRow">,
  position: Doc<"reportingInventoryPosition"> | null,
) {
  return Boolean(
    position &&
    position.version === row.postPositionVersion &&
    position.costedQuantity === row.postCostedQuantity &&
    position.uncostedQuantity === row.postUncostedQuantity &&
    position.knownCostPoolMinor === row.postKnownCostPoolMinor &&
    position.currencyCode === row.postCurrencyCode &&
    position.currencyMinorUnitScale === row.postCurrencyMinorUnitScale &&
    position.unresolvedDeficitQuantity === 0,
  );
}

export type CostOverlayUndoDisposition =
  | { kind: "compensable" }
  | { kind: "restored" }
  | { kind: "stale"; reason: string };

export async function classifyCostOverlayUndoRowWithCtx(
  ctx: WorkReadCtx,
  run: Doc<"inventoryImportCostOverlayRun">,
  row: Doc<"inventoryImportCostOverlayRow">,
): Promise<CostOverlayUndoDisposition> {
  if (
    !row.productSkuId ||
    !row.provisionalSkuId ||
    !row.applyCorrectionId ||
    row.postInventoryCount === undefined ||
    row.postQuantityAvailable === undefined ||
    row.postPositionVersion === undefined
  ) {
    return { kind: "stale", reason: "apply_evidence_missing" };
  }
  const [sku, provisional, position, lineageSet] = await Promise.all([
    ctx.db.get("productSku", row.productSkuId),
    ctx.db.get("inventoryImportProvisionalSku", row.provisionalSkuId),
    getPosition(ctx, run.storeId, row.productSkuId),
    readCostOverlaySkuLineagesWithCtx(ctx, {
      productSkuId: row.productSkuId,
      storeId: run.storeId,
    }),
  ]);
  const lineages = lineageSet.records;
  const currentLineages = lineageSet.snapshot;
  if (row.workStatus === "undone") {
    const restoredLineagesMatch = lineages
      .filter(
        (lineage) =>
          lineage.status === "active" || lineage.status === "finalized",
      )
      .every(
        (lineage) =>
          lineage.costOverlayRunId === run._id &&
          lineage.costOverlayRowId === row._id &&
          lineage.costOverlayUnitCost === undefined &&
          lineage.costOverlayUndoneAt !== undefined,
      );
    const restoredPositionMatches = Boolean(
      position &&
      position.costedQuantity === row.preCostedQuantity &&
      position.uncostedQuantity === row.preUncostedQuantity &&
      position.knownCostPoolMinor === row.preKnownCostPoolMinor &&
      position.currencyCode === row.preCurrencyCode &&
      position.currencyMinorUnitScale === row.preCurrencyMinorUnitScale &&
      position.unresolvedDeficitQuantity === 0,
    );
    return sku &&
      sku.storeId === run.storeId &&
      sku.inventoryCount === row.preInventoryCount &&
      sku.quantityAvailable === row.preQuantityAvailable &&
      sku.unitCost === row.currentUnitCostMinor &&
      restoredLineagesMatch &&
      restoredPositionMatches
      ? { kind: "restored" }
      : { kind: "stale", reason: "stale_after_undo" };
  }
  const expectedPostLineages = rowFrozenLineages(row).map((lineage) =>
    lineage.status === "active" || lineage.status === "finalized"
      ? { ...lineage, updatedAt: row.appliedAt! }
      : lineage,
  );
  if (
    !sku ||
    sku.storeId !== run.storeId ||
    sku.inventoryCount !== row.postInventoryCount ||
    sku.quantityAvailable !== row.postQuantityAvailable ||
    sku.unitCost !== row.postUnitCostMinor ||
    !position ||
    !provisional ||
    provisional.costOverlayRunId !== run._id ||
    provisional.costOverlayRowId !== row._id ||
    provisional.costOverlayUnitCost !== row.postUnitCostMinor ||
    currentLineages.length > MAX_FROZEN_LINEAGES_PER_SKU ||
    row.postLineageDigest === undefined ||
    lineageDigest(currentLineages) !== row.postLineageDigest ||
    lineageDigest(expectedPostLineages) !== row.postLineageDigest ||
    lineages
      .filter(
        (lineage) =>
          lineage.status === "active" || lineage.status === "finalized",
      )
      .some(
        (lineage) =>
          lineage.costOverlayRunId !== run._id ||
          lineage.costOverlayRowId !== row._id ||
          lineage.costOverlayUnitCost !== row.postUnitCostMinor,
      ) ||
    !positionMatchesPostState(row, position)
  ) {
    return { kind: "stale", reason: "stale_before_undo" };
  }
  if (
    !valuationPositionQuantityMatchesInventoryCount(
      position,
      sku.inventoryCount,
    )
  ) {
    return { kind: "stale", reason: "valuation_quantity_mismatch" };
  }
  return { kind: "compensable" };
}

async function markApplyException(
  ctx: MutationCtx,
  run: Doc<"inventoryImportCostOverlayRun">,
  row: Doc<"inventoryImportCostOverlayRow">,
  reason: string,
) {
  const now = Date.now();
  await ctx.db.patch("inventoryImportCostOverlayRow", row._id, {
    applyExceptionReason: reason,
    workStatus: "apply_exception",
    updatedAt: now,
  });
  await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
    applyCursor: row.rowOrdinal + 1,
    applyExceptionCount: (run.applyExceptionCount ?? 0) + 1,
    updatedAt: now,
    workHeartbeatAt: now,
  });
}

export async function applyCostOverlayRowWithCtx(
  ctx: MutationCtx,
  run: Doc<"inventoryImportCostOverlayRun">,
  row: Doc<"inventoryImportCostOverlayRow">,
) {
  if (
    !row.productSkuId ||
    !row.provisionalSkuId ||
    row.normalizedCostMinor === undefined
  ) {
    await markApplyException(ctx, run, row, "row_authority_missing");
    return;
  }
  const [sku, provisional, position, lineageSet] = await Promise.all([
    ctx.db.get("productSku", row.productSkuId),
    ctx.db.get("inventoryImportProvisionalSku", row.provisionalSkuId),
    getPosition(ctx, run.storeId, row.productSkuId),
    readCostOverlaySkuLineagesWithCtx(ctx, {
      productSkuId: row.productSkuId,
      storeId: run.storeId,
    }),
  ]);
  const lineages = lineageSet.records;
  const frozenLineages = rowFrozenLineages(row);
  const currentLineages = lineageSet.snapshot;
  const frozenMembershipIsValid = frozenCostOverlayLineagesMatch(
    frozenLineages,
    currentLineages,
  );
  if (position && position.unresolvedDeficitQuantity > 0) {
    await markApplyException(ctx, run, row, "deficit_blocked");
    return;
  }
  if (
    !sku ||
    sku.storeId !== run.storeId ||
    sku.inventoryCount !== row.preInventoryCount ||
    sku.quantityAvailable !== row.preQuantityAvailable ||
    sku.unitCost !== row.currentUnitCostMinor ||
    !provisional ||
    provisional.storeId !== run.storeId ||
    provisional.productSkuId !== row.productSkuId ||
    provisional.updatedAt !== row.preProvisionalUpdatedAt ||
    !frozenMembershipIsValid ||
    !positionMatchesPreState(row, position)
  ) {
    await markApplyException(ctx, run, row, "stale_before_apply");
    return;
  }
  if (
    position &&
    !valuationPositionQuantityMatchesInventoryCount(
      position,
      sku.inventoryCount,
    )
  ) {
    await markApplyException(ctx, run, row, "valuation_quantity_mismatch");
    return;
  }

  const now = Date.now();
  let result;
  try {
    result = await applySkuValuationCorrectionWithCtx(ctx, {
      actorUserId: actorForDirection(run, "apply"),
      correctedInventoryCount: sku.inventoryCount,
      correctedQuantityAvailable: sku.quantityAvailable,
      correctedUnitCostMinor: row.normalizedCostMinor,
      currencyCode: run.currencyCode,
      currencyMinorUnitScale: run.currencyMinorUnitScale,
      occurrenceAt: now,
      organizationId: run.organizationId,
      productSkuId: row.productSkuId,
      reason: "Legacy inventory import cost overlay",
      requestKey: `inventory-cost-overlay:${run._id}:${row._id}:apply`,
      storeId: run.storeId,
    });
  } catch (error) {
    if (!isExpectedValuationDomainError(error)) throw error;
    await markApplyException(ctx, run, row, "valuation_domain_error");
    return;
  }
  const postPosition = await getPosition(ctx, run.storeId, row.productSkuId);
  if (!postPosition) {
    throw new Error("Applied cost overlay valuation position is unavailable.");
  }
  await upsertProductSkuSearchProjection(ctx, row.productSkuId);
  const postFingerprint = JSON.stringify({
    inventoryCount: sku.inventoryCount,
    positionVersion: postPosition.version,
    productSkuId: row.productSkuId,
    quantityAvailable: sku.quantityAvailable,
    unitCost: row.normalizedCostMinor,
  });
  const patchableLineages = lineages.filter(
    (lineage) => lineage.status === "active" || lineage.status === "finalized",
  );
  for (const lineage of patchableLineages) {
    await ctx.db.patch("inventoryImportProvisionalSku", lineage._id, {
      costOverlayAppliedAt: now,
      costOverlayRunId: run._id,
      costOverlayRowId: row._id,
      costOverlaySourceDigest: run.sourceDigest,
      costOverlayUndoneAt: undefined,
      costOverlayUnitCost: row.normalizedCostMinor,
      updatedAt: now,
    });
  }
  const postLineages = currentLineages.map((lineage) =>
    lineage.status === "active" || lineage.status === "finalized"
      ? { ...lineage, updatedAt: now }
      : lineage,
  );
  await ctx.db.patch("inventoryImportCostOverlayRow", row._id, {
    appliedAt: now,
    applyCorrectionId: result.correctionId,
    applyExceptionReason: undefined,
    applyInventoryEffectId: result.inventoryEffectId,
    postCostedQuantity: postPosition.costedQuantity,
    postCurrencyCode: postPosition.currencyCode,
    postCurrencyMinorUnitScale: postPosition.currencyMinorUnitScale,
    postFingerprint,
    postLineageDigest: lineageDigest(postLineages),
    postInventoryCount: sku.inventoryCount,
    postKnownCostPoolMinor: postPosition.knownCostPoolMinor,
    postPositionVersion: postPosition.version,
    postQuantityAvailable: sku.quantityAvailable,
    postUncostedQuantity: postPosition.uncostedQuantity,
    postUnitCostMinor: row.normalizedCostMinor,
    updatedAt: now,
    workStatus: "applied",
  });
  await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
    appliedRowCount: (run.appliedRowCount ?? 0) + 1,
    applyCursor: row.rowOrdinal + 1,
    updatedAt: now,
    workHeartbeatAt: now,
  });
}

async function markUndoException(
  ctx: MutationCtx,
  run: Doc<"inventoryImportCostOverlayRun">,
  row: Doc<"inventoryImportCostOverlayRow">,
  reason: string,
) {
  const now = Date.now();
  await ctx.db.patch("inventoryImportCostOverlayRow", row._id, {
    undoExceptionReason: reason,
    updatedAt: now,
    workStatus: "undo_exception",
  });
  await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
    undoCursor: row.rowOrdinal + 1,
    undoExceptionCount: (run.undoExceptionCount ?? 0) + 1,
    updatedAt: now,
    workHeartbeatAt: now,
  });
}

export async function undoCostOverlayRowWithCtx(
  ctx: MutationCtx,
  run: Doc<"inventoryImportCostOverlayRun">,
  row: Doc<"inventoryImportCostOverlayRow">,
) {
  const disposition = await classifyCostOverlayUndoRowWithCtx(ctx, run, row);
  if (disposition.kind === "restored") return;
  if (disposition.kind === "stale") {
    await markUndoException(ctx, run, row, disposition.reason);
    return;
  }
  const productSkuId = row.productSkuId!;
  const [sku, provisional, position, lineageSet] = await Promise.all([
    ctx.db.get("productSku", productSkuId),
    ctx.db.get("inventoryImportProvisionalSku", row.provisionalSkuId!),
    getPosition(ctx, run.storeId, productSkuId),
    readCostOverlaySkuLineagesWithCtx(ctx, {
      productSkuId,
      storeId: run.storeId,
    }),
  ]);
  const lineages = lineageSet.records;
  if (!sku || !provisional || !position) {
    throw new Error("Cost overlay undo evidence changed during execution.");
  }

  const now = Date.now();
  let result;
  try {
    result = await applySkuValuationBasisCompensationWithCtx(ctx, {
      actorUserId: actorForDirection(run, "undo"),
      compensatesCorrectionId: row.applyCorrectionId,
      currencyMinorUnitScale:
        row.preCurrencyMinorUnitScale ?? run.currencyMinorUnitScale,
      expectedCurrentBasis: {
        costedQuantity: row.postCostedQuantity!,
        currencyCode: row.postCurrencyCode ?? null,
        knownCostPoolMinor: row.postKnownCostPoolMinor!,
        uncostedQuantity: row.postUncostedQuantity!,
        version: row.postPositionVersion!,
      },
      expectedInventoryCount: row.postInventoryCount!,
      expectedQuantityAvailable: row.postQuantityAvailable!,
      expectedUnitCostMinor: row.postUnitCostMinor ?? null,
      occurrenceAt: now,
      organizationId: run.organizationId,
      productSkuId,
      reason: "Undo legacy inventory import cost overlay",
      requestKey: `inventory-cost-overlay:${run._id}:${row._id}:undo`,
      storeId: run.storeId,
      targetBasis: {
        costedQuantity: row.preCostedQuantity,
        currencyCode: row.preCurrencyCode ?? null,
        knownCostPoolMinor: row.preKnownCostPoolMinor,
        uncostedQuantity: row.preUncostedQuantity,
      },
      targetUnitCostMinor: row.currentUnitCostMinor ?? null,
    });
  } catch (error) {
    if (!isExpectedValuationDomainError(error)) throw error;
    await markUndoException(ctx, run, row, "valuation_domain_error");
    return;
  }
  await upsertProductSkuSearchProjection(ctx, productSkuId);
  for (const lineage of lineages.filter(
    (candidate) =>
      candidate.status === "active" || candidate.status === "finalized",
  )) {
    await ctx.db.patch("inventoryImportProvisionalSku", lineage._id, {
      costOverlayUndoneAt: now,
      costOverlayUnitCost: undefined,
      updatedAt: now,
    });
  }
  await ctx.db.patch("inventoryImportCostOverlayRow", row._id, {
    undoCorrectionId: result.correctionId,
    undoExceptionReason: undefined,
    undoInventoryEffectId: result.inventoryEffectId,
    undoneAt: now,
    updatedAt: now,
    workStatus: "undone",
  });
  await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
    undoCursor: row.rowOrdinal + 1,
    undoneRowCount: (run.undoneRowCount ?? 0) + 1,
    updatedAt: now,
    workHeartbeatAt: now,
  });
}

export const prepareCostOverlayManifest = internalMutation({
  args: {
    runId: v.id("inventoryImportCostOverlayRun"),
    expectedEpoch: v.number(),
    expectedDecisionRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("inventoryImportCostOverlayRun", args.runId);
    if (
      !run ||
      run.status !== "preparing" ||
      run.epoch !== args.expectedEpoch ||
      run.decisionRevision !== args.expectedDecisionRevision
    ) {
      return { disposition: "stale" as const };
    }
    const rows = await ctx.db
      .query("inventoryImportCostOverlayRow")
      .withIndex("by_runId_rowOrdinal", (q) =>
        q.eq("runId", args.runId).gte("rowOrdinal", run.preparationCursor),
      )
      .take(50);
    let manifestDigest = run.manifestDigest ?? "";
    let manifestOrdinal = run.selectedRowCount;
    let impactBeforeMinor = run.impactBeforeMinor ?? 0;
    let impactAfterMinor = run.impactAfterMinor ?? 0;
    let largestImpacts = run.largestImpacts ?? [];
    let newlyIneligible = 0;
    for (const row of rows) {
      if (!isSelectedCostOverlayDecision(row.decision)) continue;
      const impact = costOverlayPreparedImpact(row);
      const nextBefore =
        impact === null ? null : safeAdd(impactBeforeMinor, impact.beforeMinor);
      const nextAfter =
        impact === null ? null : safeAdd(impactAfterMinor, impact.afterMinor);
      if (impact === null || nextBefore === null || nextAfter === null) {
        await ctx.db.patch("inventoryImportCostOverlayRow", row._id, {
          decision: "ineligible",
          eligibility: "ineligible",
          eligibilityReason: "safe_integer_overflow",
          updatedAt: Date.now(),
        });
        newlyIneligible += 1;
        continue;
      }
      const entry = JSON.stringify({
        decision: row.decision,
        decisionRevision: row.decisionRevision,
        normalizedCostMinor: row.normalizedCostMinor,
        productSkuId: row.productSkuId,
        provenanceDigest: row.provenanceDigest,
        rowId: row._id,
      });
      manifestDigest = rollCostOverlayManifestDigest(manifestDigest, entry);
      await ctx.db.patch("inventoryImportCostOverlayRow", row._id, {
        manifestEntryDigest: rollCostOverlayManifestDigest("", entry),
        manifestOrdinal,
        updatedAt: Date.now(),
      });
      manifestOrdinal += 1;
      impactBeforeMinor = nextBefore;
      impactAfterMinor = nextAfter;
      largestImpacts = mergeLargestCostOverlayImpacts(largestImpacts, {
        productName: row.productName,
        sku: row.sku,
        beforeMinor: impact.beforeMinor,
        afterMinor: impact.afterMinor,
        deltaMinor: impact.afterMinor - impact.beforeMinor,
      });
    }
    const nextCursor =
      rows.length === 0
        ? run.totalRowCount
        : rows[rows.length - 1].rowOrdinal + 1;
    const done = rows.length < 50 || nextCursor >= run.totalRowCount;
    const now = Date.now();
    if (done) {
      await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
        impactAfterMinor,
        impactBeforeMinor,
        largestImpacts,
        eligibleRowCount: run.eligibleRowCount - newlyIneligible,
        ineligibleRowCount: run.ineligibleRowCount + newlyIneligible,
        manifestDigest: manifestDigest || "811c9dc5",
        preparationCursor: nextCursor,
        preparedAt: now,
        selectedRowCount: manifestOrdinal,
        status: "prepared",
        updatedAt: now,
        workHeartbeatAt: now,
      });
      return { disposition: "completed" as const };
    }
    await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
      impactAfterMinor,
      impactBeforeMinor,
      largestImpacts,
      eligibleRowCount: run.eligibleRowCount - newlyIneligible,
      ineligibleRowCount: run.ineligibleRowCount + newlyIneligible,
      manifestDigest,
      preparationCursor: nextCursor,
      selectedRowCount: manifestOrdinal,
      updatedAt: now,
      workHeartbeatAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      makeFunctionReference<
        "mutation",
        {
          runId: Id<"inventoryImportCostOverlayRun">;
          expectedEpoch: number;
          expectedDecisionRevision: number;
        }
      >("inventory/inventoryImportCostOverlayWork:prepareCostOverlayManifest"),
      args,
    );
    return { disposition: "continued" as const };
  },
});

export const readCostOverlayConstructionPrefixBatch = internalQuery({
  args: {
    runId: v.id("inventoryImportCostOverlayRun"),
    startOrdinal: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("inventoryImportCostOverlayRun", args.runId);
    if (!run || run.status !== "draft") return [];
    const rows = await ctx.db
      .query("inventoryImportCostOverlayRow")
      .withIndex("by_runId_rowOrdinal", (q) =>
        q.eq("runId", args.runId).gte("rowOrdinal", args.startOrdinal),
      )
      .take(50);
    return rows.map((row) => ({
      anchorDigest: row.anchorDigest,
      frozenFingerprint: row.frozenFingerprint,
      frozenLineageDigest:
        (
          row as Doc<"inventoryImportCostOverlayRow"> & {
            frozenLineageDigest?: string;
          }
        ).frozenLineageDigest ?? "",
      provenanceDigest: row.provenanceDigest,
      rowOrdinal: row.rowOrdinal,
      sourceRowDigest: row.sourceRowDigest,
    }));
  },
});

export const abandonStaleCostOverlayConstruction = internalMutation({
  args: {
    runId: v.id("inventoryImportCostOverlayRun"),
    expectedCursor: v.number(),
    expectedEpoch: v.number(),
    failureReason: v.optional(
      v.union(
        v.literal("construction_prefix_changed"),
        v.literal("construction_scope_too_large"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("inventoryImportCostOverlayRun", args.runId);
    if (
      !run ||
      run.status !== "draft" ||
      run.epoch !== args.expectedEpoch ||
      run.constructionCursor !== args.expectedCursor
    ) {
      return { disposition: "stale" as const };
    }
    const now = Date.now();
    await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
      abandonedAt: now,
      constructionFailureReason:
        args.failureReason ?? "construction_prefix_changed",
      status: "abandoned",
      updatedAt: now,
      workHeartbeatAt: now,
    });
    return { disposition: "abandoned" as const };
  },
});

async function finishOrContinue(
  ctx: MutationCtx,
  args: {
    direction: WorkDirection;
    expectedEpoch: number;
    run: Doc<"inventoryImportCostOverlayRun">;
  },
) {
  const run = await ctx.db.get("inventoryImportCostOverlayRun", args.run._id);
  if (!run) throw new Error("Cost overlay run unavailable.");
  const cursor =
    args.direction === "apply" ? (run.applyCursor ?? 0) : (run.undoCursor ?? 0);
  if (cursor < run.totalRowCount) {
    await scheduleWork(ctx, {
      direction: args.direction,
      expectedEpoch: args.expectedEpoch,
      runId: run._id,
    });
    return { disposition: "continued" as const };
  }
  const exceptionCount =
    args.direction === "apply"
      ? (run.applyExceptionCount ?? 0)
      : (run.undoExceptionCount ?? 0);
  const now = Date.now();
  const status = nextCostOverlayTerminalStatus({
    direction: args.direction,
    exceptionCount,
  });
  await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
    status,
    ...(args.direction === "apply" ? { appliedAt: now } : { undoneAt: now }),
    updatedAt: now,
    workHeartbeatAt: now,
  });
  return { disposition: "completed" as const, status };
}

export const processCostOverlayApplyBatch = internalMutation({
  args: {
    runId: v.id("inventoryImportCostOverlayRun"),
    expectedEpoch: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("inventoryImportCostOverlayRun", args.runId);
    if (!run) return { disposition: "stale" as const };
    try {
      assertCostOverlayWorkFence({
        actualEpoch: run.epoch,
        actualStatus: run.status,
        direction: "apply",
        expectedEpoch: args.expectedEpoch,
      });
    } catch {
      return { disposition: "stale" as const };
    }
    const rows = await ctx.db
      .query("inventoryImportCostOverlayRow")
      .withIndex("by_runId_rowOrdinal", (q) =>
        q.eq("runId", args.runId).gte("rowOrdinal", run.applyCursor ?? 0),
      )
      .take(WORK_BATCH_SIZE);
    const row = rows[0];
    if (!row) {
      await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
        applyCursor: run.totalRowCount,
        updatedAt: Date.now(),
        workHeartbeatAt: Date.now(),
      });
      return finishOrContinue(ctx, {
        direction: "apply",
        expectedEpoch: args.expectedEpoch,
        run,
      });
    }
    if (!isSelectedCostOverlayDecision(row.decision)) {
      await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
        applyCursor: row.rowOrdinal + 1,
        updatedAt: Date.now(),
        workHeartbeatAt: Date.now(),
      });
    } else if (row.workStatus !== "applied") {
      await applyCostOverlayRowWithCtx(ctx, run, row);
    } else {
      await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
        applyCursor: row.rowOrdinal + 1,
        updatedAt: Date.now(),
        workHeartbeatAt: Date.now(),
      });
    }
    return finishOrContinue(ctx, {
      direction: "apply",
      expectedEpoch: args.expectedEpoch,
      run,
    });
  },
});

export const processCostOverlayUndoBatch = internalMutation({
  args: {
    runId: v.id("inventoryImportCostOverlayRun"),
    expectedEpoch: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("inventoryImportCostOverlayRun", args.runId);
    if (!run) return { disposition: "stale" as const };
    try {
      assertCostOverlayWorkFence({
        actualEpoch: run.epoch,
        actualStatus: run.status,
        direction: "undo",
        expectedEpoch: args.expectedEpoch,
      });
    } catch {
      return { disposition: "stale" as const };
    }
    const rows = await ctx.db
      .query("inventoryImportCostOverlayRow")
      .withIndex("by_runId_rowOrdinal", (q) =>
        q.eq("runId", args.runId).gte("rowOrdinal", run.undoCursor ?? 0),
      )
      .take(WORK_BATCH_SIZE);
    const row = rows[0];
    if (!row) {
      await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
        undoCursor: run.totalRowCount,
        updatedAt: Date.now(),
        workHeartbeatAt: Date.now(),
      });
      return finishOrContinue(ctx, {
        direction: "undo",
        expectedEpoch: args.expectedEpoch,
        run,
      });
    }
    if (row.workStatus === "applied") {
      await undoCostOverlayRowWithCtx(ctx, run, row);
    } else {
      await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
        undoCursor: row.rowOrdinal + 1,
        updatedAt: Date.now(),
        workHeartbeatAt: Date.now(),
      });
    }
    return finishOrContinue(ctx, {
      direction: "undo",
      expectedEpoch: args.expectedEpoch,
      run,
    });
  },
});

export const processCostOverlayUndoPreviewBatch = internalMutation({
  args: {
    runId: v.id("inventoryImportCostOverlayRun"),
    requestKey: v.string(),
    generation: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("inventoryImportCostOverlayRun", args.runId);
    if (
      !run ||
      run.undoPreviewStatus !== "processing" ||
      run.undoPreviewRequestKey !== args.requestKey ||
      (run.undoPreviewGeneration ?? 1) !== args.generation
    ) {
      return { disposition: "stale" as const };
    }
    const rows = await ctx.db
      .query("inventoryImportCostOverlayRow")
      .withIndex("by_runId_rowOrdinal", (q) =>
        q.eq("runId", run._id).gte("rowOrdinal", run.undoPreviewCursor ?? 0),
      )
      .take(10);
    let compensableCount = run.undoPreviewCompensableCount ?? 0;
    let staleCount = run.undoPreviewStaleCount ?? 0;
    let restoredCount = run.undoPreviewRestoredCount ?? 0;
    const reasonCounts = new Map(
      (run.undoPreviewReasons ?? []).map(({ reason, count }) => [
        reason,
        count,
      ]),
    );
    for (const row of rows) {
      if (
        row.workStatus !== "applied" &&
        row.workStatus !== "undone" &&
        row.workStatus !== "undo_exception"
      ) {
        continue;
      }
      const disposition = await classifyCostOverlayUndoRowWithCtx(
        ctx,
        run,
        row,
      );
      if (disposition.kind === "compensable") compensableCount += 1;
      else if (disposition.kind === "restored") restoredCount += 1;
      else {
        staleCount += 1;
        reasonCounts.set(
          disposition.reason,
          (reasonCounts.get(disposition.reason) ?? 0) + 1,
        );
      }
    }
    const nextCursor =
      rows.length === 0
        ? run.totalRowCount
        : rows[rows.length - 1].rowOrdinal + 1;
    const completed = rows.length < 10 || nextCursor >= run.totalRowCount;
    const now = Date.now();
    await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
      undoPreviewCompensableCount: compensableCount,
      undoPreviewCursor: nextCursor,
      undoPreviewGeneratedAt: completed ? now : undefined,
      undoPreviewReasons: [...reasonCounts.entries()]
        .sort(
          (left, right) =>
            right[1] - left[1] || left[0].localeCompare(right[0]),
        )
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count })),
      undoPreviewRestoredCount: restoredCount,
      undoPreviewStaleCount: staleCount,
      undoPreviewStatus: completed ? "ready" : "processing",
      undoPreviewHeartbeatAt: now,
      updatedAt: now,
    });
    if (!completed) {
      await ctx.scheduler.runAfter(
        0,
        makeFunctionReference<
          "mutation",
          {
            generation: number;
            runId: Id<"inventoryImportCostOverlayRun">;
            requestKey: string;
          }
        >(
          "inventory/inventoryImportCostOverlayWork:processCostOverlayUndoPreviewBatch",
        ),
        args,
      );
    }
    return {
      disposition: completed ? ("completed" as const) : ("continued" as const),
    };
  },
});
