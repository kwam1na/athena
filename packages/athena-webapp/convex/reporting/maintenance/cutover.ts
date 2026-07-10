import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import {
  REPORTING_FACT_CONTRACT_VERSION,
  REPORTING_PROJECTION_CONTRACT_VERSION,
} from "../../../shared/reportingContract";
import { recordInventoryEffectSkuEvidenceWithCtx } from "../evidence";
import { recordInventoryPositionRevisionWithCtx } from "../inventory/positionRevisions";
import { ensureActiveDeficitLedgerWithCtx } from "../inventory/deficitLedger";
import { createReportingRunWithCtx } from "./runLedger";

export const INVENTORY_CUTOVER_PAGE_LIMIT = 100;
export const INVENTORY_CUTOVER_BATCH_LIMIT = 20;

export function boundInventoryCutoverPagination(input: {
  cursor: string | null;
  numItems: number;
}) {
  if (!Number.isSafeInteger(input.numItems) || input.numItems < 1) {
    throw new Error("Cutover page size must be a positive safe integer");
  }
  return {
    cursor: input.cursor,
    numItems: Math.min(input.numItems, INVENTORY_CUTOVER_PAGE_LIMIT),
  };
}

type InventoryCutoverRun = Pick<
  Doc<"reportingRun">,
  | "actorKind"
  | "actorUserId"
  | "automationIdentity"
  | "factContractVersion"
  | "frozenWatermark"
  | "metricContractVersion"
  | "operation"
  | "organizationId"
  | "previewRunId"
  | "processedCount"
  | "projectionContractVersion"
  | "runType"
  | "status"
  | "storeId"
>;

export function assertInventoryCutoverRun<
  T extends InventoryCutoverRun,
>(input: {
  expectedOperation: "inventory_cutover_apply" | "inventory_cutover_preview";
  expectedStatus: "completed" | "running";
  organizationId: string;
  run: T | null;
  storeId: string;
}): T & { frozenWatermark: number } {
  const run = input.run;
  if (
    !run ||
    run.runType !== "cutover" ||
    run.operation !== input.expectedOperation ||
    run.status !== input.expectedStatus ||
    String(run.storeId) !== input.storeId ||
    String(run.organizationId) !== input.organizationId ||
    run.factContractVersion !== REPORTING_FACT_CONTRACT_VERSION ||
    run.metricContractVersion !== 1 ||
    run.projectionContractVersion !== REPORTING_PROJECTION_CONTRACT_VERSION ||
    run.frozenWatermark === undefined
  ) {
    throw new Error("Compatible inventory cutover run not found");
  }
  return run as T & { frozenWatermark: number };
}

function assertInventoryCutoverActor(input: {
  actorUserId?: Id<"athenaUser">;
  automationIdentity?: string;
}) {
  const hasHuman = input.actorUserId !== undefined;
  const hasAutomation = Boolean(input.automationIdentity?.trim());
  if (hasHuman === hasAutomation) {
    throw new Error("Cutover requires exactly one human or automation actor");
  }
  return hasHuman
    ? { actorKind: "human" as const, actorUserId: input.actorUserId }
    : {
        actorKind: "automation" as const,
        automationIdentity: input.automationIdentity!.trim(),
      };
}

export type InventoryBaselineInput = {
  currency: string | null;
  legacyUnresolvedDeficitQuantity?: number;
  onHandQuantity: number;
  sellableQuantity: number;
  skuId: string;
  storeId: string;
  unitCostMinor: number | null;
};

export function previewInventoryBaseline(input: InventoryBaselineInput) {
  const unresolvedDeficitQuantity = input.legacyUnresolvedDeficitQuantity ?? 0;
  for (const [field, value] of Object.entries(input)) {
    if (
      typeof value === "number" &&
      (!Number.isSafeInteger(value) || value < 0)
    ) {
      throw new Error(`${field} must be a nonnegative safe integer`);
    }
  }
  if (input.sellableQuantity > input.onHandQuantity) {
    throw new Error("sellable quantity cannot exceed on-hand quantity");
  }
  if (input.unitCostMinor !== null && input.currency === null) {
    throw new Error("known unit cost requires currency");
  }
  const unitCostMinor = input.unitCostMinor;
  const hasKnownCost = unitCostMinor !== null;
  return {
    costStatus: hasKnownCost ? ("known" as const) : ("unknown" as const),
    costedQuantity: hasKnownCost ? input.onHandQuantity : 0,
    currency: input.currency,
    knownCostPoolMinor:
      unitCostMinor === null ? 0 : input.onHandQuantity * unitCostMinor,
    onHandQuantity: input.onHandQuantity,
    sellableQuantity: input.sellableQuantity,
    signedBookPosition: input.onHandQuantity - unresolvedDeficitQuantity,
    skuId: input.skuId,
    storeId: input.storeId,
    uncostedQuantity: hasKnownCost ? 0 : input.onHandQuantity,
    unresolvedDeficitQuantity,
  };
}

type CutoverBaselineValue = Pick<
  ReturnType<typeof previewInventoryBaseline>,
  | "costedQuantity"
  | "currency"
  | "knownCostPoolMinor"
  | "onHandQuantity"
  | "sellableQuantity"
  | "uncostedQuantity"
  | "unresolvedDeficitQuantity"
>;

type ExistingCutoverPosition = Pick<
  Doc<"reportingInventoryPosition">,
  | "costedQuantity"
  | "currencyCode"
  | "currencyMinorUnitScale"
  | "knownCostPoolMinor"
  | "lastEffectAt"
  | "mode"
  | "onHandQuantity"
  | "sellableQuantity"
  | "uncostedQuantity"
  | "unresolvedDeficitQuantity"
  | "version"
>;

export function resolveCutoverBaselinePosition(input: {
  baseline: CutoverBaselineValue;
  existing: ExistingCutoverPosition | null;
  frozenWatermark: number;
}) {
  if (!input.existing) {
    return {
      ...input.baseline,
      currencyCode: input.baseline.currency ?? undefined,
      currencyMinorUnitScale: input.baseline.currency ? 2 : undefined,
      lastEffectAt: input.frozenWatermark,
      mode: "compatibility_shadow" as const,
      version: 1,
    };
  }
  const existing = input.existing;
  if (existing.mode !== "compatibility_shadow") {
    throw new Error("Cutover cannot replace active inventory authority");
  }
  if (existing.lastEffectAt > input.frozenWatermark) {
    throw new Error("Reporting position is newer than the cutover watermark");
  }
  if (
    existing.onHandQuantity !== input.baseline.onHandQuantity ||
    existing.sellableQuantity !== input.baseline.sellableQuantity
  ) {
    throw new Error("Cutover baseline does not reconcile to shadow balances");
  }
  if (
    existing.costedQuantity + existing.uncostedQuantity !==
    existing.onHandQuantity
  ) {
    throw new Error("Shadow valuation quantities do not reconcile");
  }
  if (
    existing.unresolvedDeficitQuantity !==
    input.baseline.unresolvedDeficitQuantity
  ) {
    throw new Error("Cutover deficit does not reconcile to shadow evidence");
  }
  return {
    costedQuantity: existing.costedQuantity,
    currency: existing.currencyCode ?? null,
    currencyCode: existing.currencyCode,
    currencyMinorUnitScale: existing.currencyMinorUnitScale,
    knownCostPoolMinor: existing.knownCostPoolMinor,
    lastEffectAt: existing.lastEffectAt,
    mode: "compatibility_shadow" as const,
    onHandQuantity: existing.onHandQuantity,
    sellableQuantity: existing.sellableQuantity,
    uncostedQuantity: existing.uncostedQuantity,
    unresolvedDeficitQuantity: existing.unresolvedDeficitQuantity,
    version: existing.version + 1,
  };
}

async function insertCutoverBaselineEvidence(
  ctx: MutationCtx,
  input: {
    baselineId: Id<"reportingCutoverBaseline">;
    createdAt: number;
    existingPosition: Doc<"reportingInventoryPosition"> | null;
    ledgerId: Id<"reportingInventoryDeficitLedger">;
    organizationId: Id<"organization">;
    positionId: Id<"reportingInventoryPosition">;
    productSkuId: Id<"productSku">;
    resolved: ReturnType<typeof resolveCutoverBaselinePosition>;
    storeId: Id<"store">;
  },
) {
  const lots = await ctx.db
    .query("reportingInventoryDeficitLot")
    .withIndex("by_ledgerId_status_occurredAt_outboundEffectId", (q) =>
      q.eq("ledgerId", input.ledgerId).eq("status", "open"),
    )
    .take(101);
  const durableDeficit = lots.reduce(
    (sum, lot) => sum + lot.remainingQuantity,
    0,
  );
  if (lots.length > 100) {
    throw new Error(
      "Cutover deficit evidence exceeds the bounded review limit",
    );
  }
  if (durableDeficit > input.resolved.unresolvedDeficitQuantity) {
    throw new Error("Durable deficit lots exceed the accepted baseline");
  }
  const missingDeficit =
    input.resolved.unresolvedDeficitQuantity - durableDeficit;
  for (const lot of lots) {
    await ctx.db.insert("reportingCutoverBaselineDeficitLot", {
      baselineId: input.baselineId,
      costLane: lot.costLane,
      createdAt: input.createdAt,
      occurredAt: lot.occurredAt,
      organizationId: input.organizationId,
      outboundEffectId: lot.outboundEffectId,
      positionId: input.positionId,
      productSkuId: input.productSkuId,
      remainingQuantity: lot.remainingQuantity,
      storeId: input.storeId,
    });
  }
  if (input.existingPosition && missingDeficit === 0) return null;
  const effectId = await ctx.db.insert("reportingInventoryEffect", {
    businessEventKey: `cutover:baseline:${input.baselineId}`,
    completeness: input.resolved.uncostedQuantity > 0 ? "partial" : "complete",
    contentFingerprint: [
      "inventory-cutover-baseline-v1",
      input.baselineId,
      input.resolved.onHandQuantity,
      input.resolved.sellableQuantity,
      input.resolved.knownCostPoolMinor,
      input.resolved.unresolvedDeficitQuantity,
    ].join(":"),
    costedQuantityDelta: input.existingPosition
      ? 0
      : input.resolved.costedQuantity,
    createdAt: input.createdAt,
    currencyCode: input.resolved.currencyCode,
    currencyMinorUnitScale: input.resolved.currencyMinorUnitScale,
    effectType: "baseline",
    knownCostPoolDeltaMinor: input.existingPosition
      ? 0
      : input.resolved.knownCostPoolMinor,
    occurrenceAt: input.createdAt,
    organizationId: input.organizationId,
    physicalQuantityDelta: input.existingPosition
      ? 0
      : input.resolved.onHandQuantity,
    positionId: input.positionId,
    productSkuId: input.productSkuId,
    sellableQuantityDelta: input.existingPosition
      ? 0
      : input.resolved.sellableQuantity,
    sourceDomain: "inventory",
    storeId: input.storeId,
    uncostedQuantityDelta: input.existingPosition
      ? 0
      : input.resolved.uncostedQuantity,
    unresolvedDeficitDelta: input.existingPosition
      ? 0
      : input.resolved.unresolvedDeficitQuantity,
  });
  await ctx.db.insert("reportingInventoryEffectSourceReference", {
    createdAt: input.createdAt,
    effectId,
    relation: "seeds",
    sourceId: String(input.baselineId),
    sourceType: "reporting_cutover_baseline",
    storeId: input.storeId,
  });
  const effect = await ctx.db.get("reportingInventoryEffect", effectId);
  if (!effect) throw new Error("Cutover baseline effect was not persisted");
  await recordInventoryEffectSkuEvidenceWithCtx(ctx, effect);
  if (missingDeficit > 0) {
    await ctx.db.insert("reportingInventoryDeficitLot", {
      costLane: "inventory_adjustment",
      createdAt: input.createdAt,
      occurredAt: input.createdAt,
      organizationId: input.organizationId,
      outboundEffectId: effectId,
      positionId: input.positionId,
      ledgerId: input.ledgerId,
      productSkuId: input.productSkuId,
      remainingQuantity: missingDeficit,
      status: "open",
      storeId: input.storeId,
      updatedAt: input.createdAt,
    });
    await ctx.db.insert("reportingCutoverBaselineDeficitLot", {
      baselineId: input.baselineId,
      costLane: "inventory_adjustment",
      createdAt: input.createdAt,
      occurredAt: input.createdAt,
      organizationId: input.organizationId,
      outboundEffectId: effectId,
      positionId: input.positionId,
      productSkuId: input.productSkuId,
      remainingQuantity: missingDeficit,
      storeId: input.storeId,
    });
  }
  return effectId;
}

export const startInventoryCutover = internalMutation({
  args: {
    actorUserId: v.optional(v.id("athenaUser")),
    automationIdentity: v.optional(v.string()),
    mode: v.union(v.literal("preview"), v.literal("apply")),
    previewRunId: v.optional(v.id("reportingRun")),
    requestKey: v.string(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) throw new Error("Store not found");
    const actor = assertInventoryCutoverActor(args);
    let previewRun: Doc<"reportingRun"> | null = null;
    if (args.mode === "apply") {
      if (!args.previewRunId) {
        throw new Error("Cutover apply requires a completed preview run");
      }
      previewRun = assertInventoryCutoverRun({
        expectedOperation: "inventory_cutover_preview",
        expectedStatus: "completed",
        organizationId: String(store.organizationId),
        run: await ctx.db.get("reportingRun", args.previewRunId),
        storeId: String(store._id),
      });
    } else if (args.previewRunId) {
      throw new Error("Cutover preview cannot reference another preview run");
    }
    const now = Date.now();
    const result = await createReportingRunWithCtx(ctx, {
      ...actor,
      createdAt: now,
      domain: "inventory",
      factContractVersion: REPORTING_FACT_CONTRACT_VERSION,
      metricContractVersion: 1,
      operation: `inventory_cutover_${args.mode}`,
      organizationId: store.organizationId,
      projectionContractVersion: REPORTING_PROJECTION_CONTRACT_VERSION,
      requestKey: `${args.mode}:${args.requestKey}`,
      runType: "cutover",
      storeId: store._id,
    });
    if (!result.created) return { created: false, runId: result.run._id };
    const frozenWatermark = previewRun?.frozenWatermark ?? now;
    await ctx.db.patch("reportingRun", result.run._id, {
      frozenWatermark,
      previewRunId: previewRun?._id,
      startedAt: now,
      status: "running",
    });
    await ctx.db.insert("reportingRunEvent", {
      eventType: "inventory_cutover_started",
      occurredAt: now,
      outcome: args.mode,
      runId: result.run._id,
      sequence: 2,
      storeId: store._id,
    });
    return { created: true, runId: result.run._id };
  },
});

export const previewInventoryCutover = internalMutation({
  args: {
    paginationOpts: paginationOptsValidator,
    runId: v.id("reportingRun"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) throw new Error("Store not found");
    const run = assertInventoryCutoverRun({
      expectedOperation: "inventory_cutover_preview",
      expectedStatus: "running",
      organizationId: String(store.organizationId),
      run: await ctx.db.get("reportingRun", args.runId),
      storeId: String(store._id),
    });
    const expectedCursor = run.cursor ?? null;
    if (args.paginationOpts.cursor !== expectedCursor) {
      throw new Error("Inventory cutover preview cursor is stale");
    }
    const page = await ctx.db
      .query("productSku")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .paginate(
        boundInventoryCutoverPagination({
          cursor: expectedCursor,
          numItems: args.paginationOpts.numItems,
        }),
      );
    if (page.page.some((sku) => sku.storeId !== args.storeId)) {
      throw new Error("Cutover preview returned a cross-store SKU");
    }
    const now = Date.now();
    const previewRows = page.page.map((sku) => ({
      baseline: previewInventoryBaseline({
        currency: sku.unitCost === undefined ? null : store.currency,
        onHandQuantity: sku.inventoryCount,
        sellableQuantity: sku.quantityAvailable,
        skuId: String(sku._id),
        storeId: String(args.storeId),
        unitCostMinor: sku.unitCost ?? null,
      }),
      sku,
    }));
    for (const { baseline, sku } of previewRows) {
      await ctx.db.insert("reportingCutoverPreviewItem", {
        costedQuantity: baseline.costedQuantity,
        createdAt: now,
        currencyCode: baseline.currency ?? undefined,
        knownCostPoolMinor: baseline.knownCostPoolMinor,
        onHandQuantity: baseline.onHandQuantity,
        organizationId: store.organizationId,
        productSkuId: sku._id,
        runId: run._id,
        sellableQuantity: baseline.sellableQuantity,
        sourceWatermark: run.frozenWatermark,
        storeId: store._id,
        uncostedQuantity: baseline.uncostedQuantity,
        unitCostMinor: sku.unitCost,
        unresolvedDeficitQuantity: baseline.unresolvedDeficitQuantity,
      });
    }
    const processedCount = run.processedCount + page.page.length;
    await ctx.db.patch("reportingRun", run._id, {
      completedAt: page.isDone ? now : undefined,
      cursor: page.isDone ? undefined : page.continueCursor,
      processedCount,
      status: page.isDone ? "completed" : "running",
    });
    await ctx.db.insert("reportingRunEvent", {
      cursor: page.continueCursor,
      eventType: page.isDone
        ? "inventory_cutover_preview_completed"
        : "inventory_cutover_preview_page",
      occurredAt: now,
      outcome: page.isDone ? "completed" : "continued",
      processedCount: page.page.length,
      runId: run._id,
      sequence: processedCount + 3,
      storeId: store._id,
    });
    return {
      ...page,
      runId: run._id,
      page: previewRows.map(({ baseline }) => baseline),
      runStatus: page.isDone ? ("completed" as const) : ("running" as const),
    };
  },
});

export const acceptInventoryCutoverBatch = internalMutation({
  args: {
    acceptedByUserId: v.optional(v.id("athenaUser")),
    baselines: v.array(
      v.object({
        currency: v.optional(v.string()),
        expectedOnHandQuantity: v.number(),
        expectedSellableQuantity: v.number(),
        productSkuId: v.id("productSku"),
        unitCostMinor: v.optional(v.number()),
        unresolvedDeficitQuantity: v.optional(v.number()),
      }),
    ),
    isFinalBatch: v.boolean(),
    runId: v.id("reportingRun"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    if (
      args.baselines.length === 0 ||
      args.baselines.length > INVENTORY_CUTOVER_BATCH_LIMIT
    ) {
      throw new Error("Cutover batches require between 1 and 20 SKUs");
    }
    if (
      new Set(args.baselines.map((baseline) => String(baseline.productSkuId)))
        .size !== args.baselines.length
    ) {
      throw new Error("Cutover batches cannot contain duplicate SKUs");
    }
    const store = await ctx.db.get("store", args.storeId);
    if (!store) throw new Error("Store not found");
    const run = assertInventoryCutoverRun({
      expectedOperation: "inventory_cutover_apply",
      expectedStatus: "running",
      organizationId: String(store.organizationId),
      run: await ctx.db.get("reportingRun", args.runId),
      storeId: String(store._id),
    });
    if (
      run.actorKind === "human" &&
      (!run.actorUserId || args.acceptedByUserId !== run.actorUserId)
    ) {
      throw new Error("Cutover acceptance actor does not match its run");
    }
    if (run.actorKind === "automation" && args.acceptedByUserId) {
      throw new Error(
        "Automated cutover cannot claim a human acceptance actor",
      );
    }
    if (!run.previewRunId) {
      throw new Error("Cutover apply is missing its preview evidence");
    }
    const previewRun = assertInventoryCutoverRun({
      expectedOperation: "inventory_cutover_preview",
      expectedStatus: "completed",
      organizationId: String(store.organizationId),
      run: await ctx.db.get("reportingRun", run.previewRunId),
      storeId: String(store._id),
    });
    if (
      previewRun?.status !== "completed" ||
      previewRun.frozenWatermark !== run.frozenWatermark
    ) {
      throw new Error("Cutover preview evidence is incomplete or incompatible");
    }
    const now = Date.now();
    const acceptedIds: Id<"reportingCutoverBaseline">[] = [];
    let acceptedCount = 0;
    for (const input of args.baselines) {
      const sku = await ctx.db.get("productSku", input.productSkuId);
      const previewItems = await ctx.db
        .query("reportingCutoverPreviewItem")
        .withIndex("by_runId_productSkuId", (q) =>
          q.eq("runId", previewRun._id).eq("productSkuId", input.productSkuId),
        )
        .take(2);
      if (previewItems.length !== 1) {
        throw new Error("Cutover SKU was not uniquely included in its preview");
      }
      const previewItem = previewItems[0]!;
      const expectedCurrency = input.currency?.trim().toUpperCase();
      if (
        !sku ||
        sku.storeId !== args.storeId ||
        previewItem.storeId !== args.storeId ||
        previewItem.organizationId !== store.organizationId ||
        previewItem.sourceWatermark !== run.frozenWatermark ||
        sku.inventoryCount !== input.expectedOnHandQuantity ||
        sku.quantityAvailable !== input.expectedSellableQuantity ||
        sku.inventoryCount !== previewItem.onHandQuantity ||
        sku.quantityAvailable !== previewItem.sellableQuantity ||
        sku.unitCost !== previewItem.unitCostMinor ||
        expectedCurrency !== previewItem.currencyCode ||
        input.unitCostMinor !== previewItem.unitCostMinor ||
        (input.unresolvedDeficitQuantity ?? 0) !==
          previewItem.unresolvedDeficitQuantity ||
        (sku.unitCost === undefined
          ? previewItem.currencyCode !== undefined
          : store.currency.trim().toUpperCase() !== previewItem.currencyCode)
      ) {
        throw new Error("Cutover baseline is stale");
      }
      const prior = await ctx.db
        .query("reportingCutoverBaseline")
        .withIndex("by_storeId_productSkuId_status", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("productSkuId", input.productSkuId)
            .eq("status", "accepted"),
        )
        .first();
      if (previewItem.acceptedByRunId === run._id) {
        if (prior?.runId !== run._id) {
          throw new Error(
            "Cutover preview acceptance evidence is inconsistent",
          );
        }
        acceptedIds.push(prior._id);
        continue;
      }
      if (previewItem.acceptedByRunId) {
        throw new Error("Cutover preview SKU was accepted by another run");
      }
      const baseline = previewInventoryBaseline({
        currency: previewItem.currencyCode ?? null,
        legacyUnresolvedDeficitQuantity: previewItem.unresolvedDeficitQuantity,
        onHandQuantity: previewItem.onHandQuantity,
        sellableQuantity: previewItem.sellableQuantity,
        skuId: String(sku._id),
        storeId: String(args.storeId),
        unitCostMinor: previewItem.unitCostMinor ?? null,
      });
      const positions = await ctx.db
        .query("reportingInventoryPosition")
        .withIndex("by_storeId_productSkuId", (q) =>
          q.eq("storeId", args.storeId).eq("productSkuId", input.productSkuId),
        )
        .take(2);
      if (positions.length > 1) {
        throw new Error("SKU has multiple reporting inventory positions");
      }
      const resolved = resolveCutoverBaselinePosition({
        baseline,
        existing: positions[0] ?? null,
        frozenWatermark: run.frozenWatermark,
      });
      if (prior) {
        await ctx.db.patch("reportingCutoverBaseline", prior._id, {
          status: "superseded",
        });
      }
      const baselineId = await ctx.db.insert("reportingCutoverBaseline", {
        acceptedAt: now,
        acceptedByUserId: args.acceptedByUserId,
        costedQuantity: resolved.costedQuantity,
        createdAt: now,
        currencyCode: resolved.currencyCode,
        currencyMinorUnitScale: resolved.currencyMinorUnitScale,
        effectiveAt: run.frozenWatermark,
        knownCostPoolMinor: resolved.knownCostPoolMinor,
        onHandQuantity: resolved.onHandQuantity,
        organizationId: run.organizationId,
        productSkuId: input.productSkuId,
        runId: run._id,
        sellableQuantity: resolved.sellableQuantity,
        sourceWatermark: run.frozenWatermark,
        status: "accepted",
        storeId: args.storeId,
        supersedesBaselineId: prior?._id,
        uncostedQuantity: resolved.uncostedQuantity,
        unresolvedDeficitQuantity: resolved.unresolvedDeficitQuantity,
        version: (prior?.version ?? 0) + 1,
      });
      acceptedIds.push(baselineId);
      acceptedCount += 1;
      await ctx.db.patch("reportingCutoverPreviewItem", previewItem._id, {
        acceptedAt: now,
        acceptedByRunId: run._id,
      });
      const positionValue = {
        costedQuantity: resolved.costedQuantity,
        currencyCode: resolved.currencyCode,
        currencyMinorUnitScale: resolved.currencyMinorUnitScale,
        knownCostPoolMinor: resolved.knownCostPoolMinor,
        lastEffectAt: resolved.lastEffectAt,
        mode: "compatibility_shadow" as const,
        onHandQuantity: resolved.onHandQuantity,
        organizationId: run.organizationId,
        productSkuId: input.productSkuId,
        sellableQuantity: resolved.sellableQuantity,
        storeId: args.storeId,
        uncostedQuantity: resolved.uncostedQuantity,
        unresolvedDeficitQuantity: resolved.unresolvedDeficitQuantity,
        updatedAt: now,
        version: resolved.version,
      };
      let positionId: Id<"reportingInventoryPosition">;
      if (positions[0]) {
        positionId = positions[0]._id;
        await ctx.db.patch(
          "reportingInventoryPosition",
          positionId,
          positionValue,
        );
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
      if (!positionForLedger) {
        throw new Error("Cutover inventory position disappeared");
      }
      const deficitLedgerId = await ensureActiveDeficitLedgerWithCtx(ctx, {
        position: positionForLedger,
        recordedAt: now,
      });
      const baselineEffectId = await insertCutoverBaselineEvidence(ctx, {
        baselineId,
        createdAt: run.frozenWatermark,
        existingPosition: positions[0] ?? null,
        ledgerId: deficitLedgerId,
        organizationId: run.organizationId,
        positionId,
        productSkuId: input.productSkuId,
        resolved,
        storeId: args.storeId,
      });
      if (baselineEffectId) {
        await ctx.db.patch("reportingInventoryPosition", positionId, {
          lastEffectAt: run.frozenWatermark,
          updatedAt: now,
        });
      }
      await recordInventoryPositionRevisionWithCtx(ctx, {
        baselineId,
        ...(baselineEffectId ? { effectId: baselineEffectId } : {}),
        organizationId: run.organizationId,
        positionId,
        productSkuId: input.productSkuId,
        recordedAt: now,
        revisionKind: "baseline_applied",
        storeId: args.storeId,
      });
    }
    const processedCount = run.processedCount + acceptedCount;
    if (processedCount > previewRun.processedCount) {
      throw new Error("Cutover apply exceeds the completed preview scope");
    }
    if (args.isFinalBatch && processedCount !== previewRun.processedCount) {
      throw new Error(
        "Cutover apply cannot complete before every previewed SKU is accepted",
      );
    }
    await ctx.db.patch("reportingRun", run._id, {
      completedAt: args.isFinalBatch ? now : undefined,
      processedCount,
      status: args.isFinalBatch ? "completed" : "running",
    });
    await ctx.db.insert("reportingRunEvent", {
      eventType: args.isFinalBatch
        ? "inventory_cutover_apply_completed"
        : "inventory_cutover_batch_accepted",
      occurredAt: now,
      outcome: args.isFinalBatch ? "completed" : "continued",
      processedCount: acceptedCount,
      runId: run._id,
      sequence: processedCount + 3,
      storeId: run.storeId,
    });
    return {
      acceptedIds,
      processedCount,
      status: args.isFinalBatch ? ("completed" as const) : ("running" as const),
    };
  },
});
