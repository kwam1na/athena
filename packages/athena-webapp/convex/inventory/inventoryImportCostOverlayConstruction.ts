"use node";

import { createHash } from "node:crypto";

import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import {
  buildInventoryImportSourceRowIdentity,
  interpretInventoryImportCost,
  INVENTORY_IMPORT_SOURCE_PROJECTION_VERSION,
  inventoryImportSourceRowToRecord,
  projectInventoryImportSource,
  type InventoryImportSourceCell,
  type InventoryImportSourceColumn,
} from "../../shared/inventoryImportSource";
import {
  getUtf8ByteLength,
  INVENTORY_IMPORT_REVIEW_PAYLOAD_CHUNK_MAX_BYTES,
  INVENTORY_IMPORT_REVIEW_PAYLOAD_MAX_BYTES,
  INVENTORY_IMPORT_REVIEW_PAYLOAD_MAX_CHUNKS,
} from "../../shared/inventoryImportReviewPayload";
import {
  canonicalizeCostOverlayLineages,
  MAX_FROZEN_LINEAGES_PER_SKU,
  type FrozenInventoryImportLineage,
} from "./inventoryImportCostOverlayLineage";

type ConstructionState = {
  cursor: number;
  epoch: number;
  status: string;
  reviewVersionId: Id<"inventoryImportReviewVersion">;
  selectedColumn:
    | { kind: "csv"; label: string; ordinal: number }
    | { kind: "json"; path: string };
  sourceProjectionVersion: string;
  sourceDigest?: string;
  constructionSnapshotDigest?: string;
  constructionSnapshotRowCount?: number;
  currencyMinorUnitScale: number;
};

type ReviewSource = {
  fileName?: string;
  payloadChunkCount?: number;
  rawContent?: string;
  rawContentChunkCount?: number;
};

type ConstructionAnchor = {
  provisionalSkuId: Id<"inventoryImportProvisionalSku">;
  productSkuId?: Id<"productSku">;
  rowKey: string;
  rowNumber: number;
  status: "active" | "finalized" | "rejected" | "closed";
  finalizedAt?: number;
  provisionalUpdatedAt: number;
  sku?: {
    barcode?: string;
    inventoryCount: number;
    productName?: string;
    quantityAvailable: number;
    sku?: string;
    unitCost?: number;
    updatedAt?: number;
  };
  position?: {
    costedQuantity: number;
    currencyCode?: string;
    currencyMinorUnitScale?: number;
    knownCostPoolMinor: number;
    uncostedQuantity: number;
    version: number;
  };
};

type CostOutcome =
  | "valid"
  | "missing"
  | "invalid_syntax"
  | "negative"
  | "excess_precision"
  | "out_of_range";

type MaterializedRow = {
  rowOrdinal: number;
  sourceRowKey: string;
  sourceRowDigest: string;
  sourceRawValue?: string;
  productSkuId?: Id<"productSku">;
  provisionalSkuId?: Id<"inventoryImportProvisionalSku">;
  productName: string;
  sku?: string;
  barcode?: string;
  normalizedCostMinor?: number;
  costOutcome: CostOutcome;
  provenanceDigest: string;
  anchorDigest: string;
  currentUnitCostMinor?: number;
  preInventoryCount: number;
  preQuantityAvailable: number;
  preCostedQuantity: number;
  preUncostedQuantity: number;
  preKnownCostPoolMinor: number;
  preCurrencyCode?: string;
  preCurrencyMinorUnitScale?: number;
  preProvisionalUpdatedAt: number;
  frozenLineages: FrozenInventoryImportLineage[];
  frozenLineageDigest: string;
  lifecycle: "provisional" | "trusted";
  eligibility: "eligible" | "ineligible";
  eligibilityReason?: string;
  decision:
    | "selected_missing_cost"
    | "overwrite_selected"
    | "not_selected"
    | "ineligible";
  frozenFingerprint: string;
  prePositionVersion?: number;
};

export const COST_OVERLAY_SOURCE_RAW_VALUE_PREVIEW_MAX_BYTES = 4 * 1024;
export const COST_OVERLAY_CONSTRUCTION_ANCHOR_LIMIT = 5_000;
export const COST_OVERLAY_CONSTRUCTION_ANCHOR_PAGE_SIZE = 100;
export const COST_OVERLAY_CONSTRUCTION_BATCH_SIZE = 50;
export const COST_OVERLAY_CONSTRUCTION_BATCHES_PER_INVOCATION = 20;
export const COST_OVERLAY_CONSTRUCTION_HEARTBEAT_PAGE_INTERVAL = 5;
export const COST_OVERLAY_CONSTRUCTION_MAX_FULL_REBUILDS = Math.ceil(
  COST_OVERLAY_CONSTRUCTION_ANCHOR_LIMIT /
    (COST_OVERLAY_CONSTRUCTION_BATCH_SIZE *
      COST_OVERLAY_CONSTRUCTION_BATCHES_PER_INVOCATION),
);
export const COST_OVERLAY_CONSTRUCTION_MAX_QUERY_CALLS =
  1 + // construction state
  1 + // review source
  INVENTORY_IMPORT_REVIEW_PAYLOAD_MAX_CHUNKS +
  Math.ceil(
    (COST_OVERLAY_CONSTRUCTION_ANCHOR_LIMIT + 1) /
      COST_OVERLAY_CONSTRUCTION_ANCHOR_PAGE_SIZE,
  ) +
  1; // legacy prefix verification
export const COST_OVERLAY_CONSTRUCTION_MAX_MUTATION_CALLS =
  2 + // action start and post-source heartbeats
  Math.floor(
    COST_OVERLAY_CONSTRUCTION_ANCHOR_LIMIT /
      COST_OVERLAY_CONSTRUCTION_ANCHOR_PAGE_SIZE /
      COST_OVERLAY_CONSTRUCTION_HEARTBEAT_PAGE_INTERVAL,
  ) +
  COST_OVERLAY_CONSTRUCTION_BATCHES_PER_INVOCATION;

const CONSTRUCTION_SCOPE_TOO_LARGE = "construction_scope_too_large";

class ConstructionScopeError extends Error {
  constructor() {
    super("Cost overlay source is too large to construct safely.");
  }
}

class StaleConstructionError extends Error {}

const readConstructionState = makeFunctionReference<
  "query",
  { runId: Id<"inventoryImportCostOverlayRun"> },
  ConstructionState
>("inventory/inventoryImportCostOverlay:readCostOverlayConstructionState");

const heartbeatConstruction = makeFunctionReference<
  "mutation",
  {
    runId: Id<"inventoryImportCostOverlayRun">;
    expectedEpoch: number;
  },
  { disposition: "active" | "stale" }
>("inventory/inventoryImportCostOverlay:heartbeatCostOverlayConstruction");

const readReviewSource = makeFunctionReference<
  "query",
  { runId: Id<"inventoryImportCostOverlayRun"> },
  ReviewSource
>("inventory/inventoryImportCostOverlay:readCostOverlayReviewSource");

const readReviewSourceChunk = makeFunctionReference<
  "query",
  {
    runId: Id<"inventoryImportCostOverlayRun">;
    chunkIndex: number;
  },
  { kind: "raw_content" | "row_decisions"; rawContent?: string } | null
>("inventory/inventoryImportCostOverlay:readCostOverlayReviewSourceChunk");

const readConstructionAnchors = makeFunctionReference<
  "query",
  {
    runId: Id<"inventoryImportCostOverlayRun">;
    paginationOpts: { cursor: string | null; numItems: number };
  },
  {
    page: ConstructionAnchor[];
    continueCursor: string;
    isDone: boolean;
  }
>("inventory/inventoryImportCostOverlay:readCostOverlayConstructionAnchors");

const appendConstructionBatch = makeFunctionReference<
  "mutation",
  {
    runId: Id<"inventoryImportCostOverlayRun">;
    expectedEpoch: number;
    expectedCursor: number;
    rows: MaterializedRow[];
    isDone: boolean;
    sourceDigest?: string;
    constructionSnapshotDigest: string;
    constructionSnapshotRowCount: number;
  },
  { cursor: number; status: string }
>("inventory/inventoryImportCostOverlay:appendCostOverlayConstructionBatch");

const readConstructionPrefixBatch = makeFunctionReference<
  "query",
  {
    runId: Id<"inventoryImportCostOverlayRun">;
    startOrdinal: number;
  },
  Array<{
    rowOrdinal: number;
    anchorDigest: string;
    frozenFingerprint: string;
    frozenLineageDigest: string;
    provenanceDigest: string;
    sourceRowDigest: string;
  }>
>(
  "inventory/inventoryImportCostOverlayWork:readCostOverlayConstructionPrefixBatch",
);

const abandonStaleConstruction = makeFunctionReference<
  "mutation",
  {
    runId: Id<"inventoryImportCostOverlayRun">;
    expectedCursor: number;
    expectedEpoch: number;
    failureReason?:
      "construction_prefix_changed" | "construction_scope_too_large";
  },
  { disposition: "abandoned" | "stale" }
>(
  "inventory/inventoryImportCostOverlayWork:abandonStaleCostOverlayConstruction",
);

const continueCostOverlayConstruction = makeFunctionReference<
  "action",
  {
    runId: Id<"inventoryImportCostOverlayRun">;
    expectedEpoch: number;
  }
>("inventory/inventoryImportCostOverlayConstruction:constructCostOverlayRun");

async function heartbeatConstructionOrThrow(
  ctx: ActionCtx,
  args: {
    runId: Id<"inventoryImportCostOverlayRun">;
    expectedEpoch: number;
  },
) {
  const heartbeat = await ctx.runMutation(heartbeatConstruction, args);
  if (heartbeat.disposition === "stale") {
    throw new StaleConstructionError();
  }
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function costOverlayConstructionIdentity(
  row: Pick<
    MaterializedRow,
    | "anchorDigest"
    | "frozenFingerprint"
    | "frozenLineageDigest"
    | "provenanceDigest"
    | "rowOrdinal"
    | "sourceRowDigest"
  >,
) {
  return digest({
    anchorDigest: row.anchorDigest,
    frozenFingerprint: row.frozenFingerprint,
    frozenLineageDigest: row.frozenLineageDigest,
    provenanceDigest: row.provenanceDigest,
    rowOrdinal: row.rowOrdinal,
    sourceRowDigest: row.sourceRowDigest,
  });
}

function safeMultiply(left: number, right: number) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return null;
  const value = BigInt(left) * BigInt(right);
  return value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
    ? null
    : Number(value);
}

function selectedColumnFor(
  columns: InventoryImportSourceColumn[],
  selected:
    | { kind: "csv"; label: string; ordinal: number }
    | { kind: "json"; path: string },
) {
  return columns.find((column) =>
    selected.kind === "csv"
      ? column.label === selected.label && column.ordinal === selected.ordinal
      : column.sourcePath === selected.path,
  );
}

function rawValueFor(cells: InventoryImportSourceCell[], columnId: string) {
  return cells.find((cell) => cell.columnId === columnId)?.rawValue;
}

function truncateUtf8(value: string, maxBytes: number) {
  if (getUtf8ByteLength(value) <= maxBytes) return value;
  let low = 0;
  let high = Math.min(value.length, maxBytes);
  let end = 0;
  while (low <= high) {
    const midpoint = low + Math.floor((high - low) / 2);
    let candidate = midpoint;
    if (
      candidate > 0 &&
      candidate < value.length &&
      value.charCodeAt(candidate - 1) >= 0xd800 &&
      value.charCodeAt(candidate - 1) <= 0xdbff
    ) {
      candidate -= 1;
    }
    if (getUtf8ByteLength(value.slice(0, candidate)) <= maxBytes) {
      end = candidate;
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }
  return value.slice(0, end);
}

function serializeRawValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return serialized === undefined
    ? undefined
    : truncateUtf8(serialized, COST_OVERLAY_SOURCE_RAW_VALUE_PREVIEW_MAX_BYTES);
}

function normalizeOutcome(
  outcome: ReturnType<typeof interpretInventoryImportCost>,
): { kind: CostOutcome; minorUnits?: number } {
  return outcome.kind === "invalid"
    ? { kind: "invalid_syntax" }
    : outcome.kind === "valid"
      ? { kind: "valid", minorUnits: outcome.minorUnits }
      : { kind: outcome.kind };
}

export function materializeCostOverlayRows(args: {
  anchors: ConstructionAnchor[];
  content: string;
  fileName?: string;
  selectedColumn: ConstructionState["selectedColumn"];
  currencyMinorUnitScale: number;
}) {
  const projection = projectInventoryImportSource({
    content: args.content,
    fileName: args.fileName,
  });
  if (projection.errors.length > 0) {
    throw new Error(`Saved review source is invalid: ${projection.errors[0]}`);
  }
  const column = selectedColumnFor(projection.columns, args.selectedColumn);
  if (!column) throw new Error("Selected cost source column is unavailable.");

  const sourceByRowKey = new Map(
    projection.rows.map((row) => [
      buildInventoryImportSourceRowIdentity(
        inventoryImportSourceRowToRecord(projection, row),
        row.rowNumber,
      ).rowKey,
      row,
    ]),
  );
  const matchingAnchors = args.anchors.filter((anchor) =>
    sourceByRowKey.has(anchor.rowKey),
  );
  const candidatesBySku = new Map<
    string,
    Array<{
      anchor: ConstructionAnchor;
      outcome: ReturnType<typeof normalizeOutcome>;
      rawValue: unknown;
      sourceRowDigest: string;
    }>
  >();

  const frozenLineagesBySku = new Map<string, FrozenInventoryImportLineage[]>();
  for (const anchor of args.anchors) {
    if (!anchor.productSkuId) continue;
    const skuKey = String(anchor.productSkuId);
    frozenLineagesBySku.set(skuKey, [
      ...(frozenLineagesBySku.get(skuKey) ?? []),
      {
        provisionalSkuId: anchor.provisionalSkuId,
        productSkuId: anchor.productSkuId,
        status: anchor.status,
        updatedAt: anchor.provisionalUpdatedAt,
      },
    ]);
  }
  for (const [skuKey, lineages] of frozenLineagesBySku) {
    frozenLineagesBySku.set(skuKey, canonicalizeCostOverlayLineages(lineages));
  }

  for (const anchor of matchingAnchors) {
    if (
      !anchor.productSkuId ||
      !anchor.sku ||
      (anchor.status !== "active" && anchor.status !== "finalized")
    ) {
      continue;
    }
    const sourceRow = sourceByRowKey.get(anchor.rowKey)!;
    const rawValue = rawValueFor(sourceRow.cells, column.id);
    const outcome = normalizeOutcome(
      interpretInventoryImportCost(rawValue, {
        currencyScale: args.currencyMinorUnitScale,
      }),
    );
    const candidate = {
      anchor,
      outcome,
      rawValue,
      sourceRowDigest: digest({
        rowId: sourceRow?.id ?? anchor.rowKey,
        sourcePath: sourceRow?.sourcePath,
        rawValue,
      }),
    };
    const skuKey = String(anchor.productSkuId);
    candidatesBySku.set(skuKey, [
      ...(candidatesBySku.get(skuKey) ?? []),
      candidate,
    ]);
  }

  return Array.from(candidatesBySku.values())
    .sort((left, right) =>
      String(left[0].anchor.productSkuId).localeCompare(
        String(right[0].anchor.productSkuId),
      ),
    )
    .map((candidates, rowOrdinal): MaterializedRow => {
      const anchor = candidates[0].anchor;
      const validCosts = Array.from(
        new Set(
          candidates.flatMap((candidate) =>
            candidate.outcome.kind === "valid"
              ? [candidate.outcome.minorUnits]
              : [],
          ),
        ),
      );
      const hasConflict = validCosts.length > 1;
      const representative =
        candidates.find((candidate) => candidate.outcome.kind === "valid") ??
        candidates[0];
      const position = anchor.position;
      const sku = anchor.sku!;
      const inferredCostedQuantity =
        sku.unitCost === undefined ? 0 : sku.inventoryCount;
      const preCostedQuantity =
        position?.costedQuantity ?? inferredCostedQuantity;
      const preUncostedQuantity =
        position?.uncostedQuantity ??
        (sku.unitCost === undefined ? sku.inventoryCount : 0);
      const inferredKnownCostPoolMinor =
        sku.unitCost === undefined
          ? 0
          : safeMultiply(sku.unitCost, sku.inventoryCount);
      const preKnownCostPoolMinor =
        position?.knownCostPoolMinor ?? inferredKnownCostPoolMinor ?? 0;
      const preKnownCostPoolIsSafe =
        position !== undefined
          ? Number.isSafeInteger(position.knownCostPoolMinor) &&
            position.knownCostPoolMinor >= 0
          : inferredKnownCostPoolMinor !== null;
      const frozenLineages =
        frozenLineagesBySku.get(String(anchor.productSkuId)) ?? [];
      const normalizedCostMinor =
        representative.outcome.kind === "valid"
          ? representative.outcome.minorUnits
          : undefined;
      const postKnownCostPoolMinor =
        normalizedCostMinor === undefined
          ? null
          : safeMultiply(sku.inventoryCount, normalizedCostMinor);
      const eligibilityReason =
        frozenLineages.length > MAX_FROZEN_LINEAGES_PER_SKU
          ? "lineage_limit_exceeded"
          : !preKnownCostPoolIsSafe || postKnownCostPoolMinor === null
            ? "safe_integer_overflow"
            : hasConflict
              ? "conflicting_source_costs"
              : representative.outcome.kind !== "valid"
                ? representative.outcome.kind
                : undefined;
      const eligibility = eligibilityReason ? "ineligible" : "eligible";
      const lifecycle =
        anchor.status === "finalized" || anchor.finalizedAt !== undefined
          ? "trusted"
          : "provisional";
      const decision =
        eligibility === "ineligible"
          ? "ineligible"
          : sku.unitCost === undefined
            ? "selected_missing_cost"
            : "not_selected";
      const provenance = candidates.map((candidate) => ({
        provisionalSkuId: candidate.anchor.provisionalSkuId,
        rowKey: candidate.anchor.rowKey,
        rowNumber: candidate.anchor.rowNumber,
        rawValue: candidate.rawValue,
        sourceRowDigest: candidate.sourceRowDigest,
      }));
      const frozen = {
        inventoryCount: sku.inventoryCount,
        position,
        productSkuId: anchor.productSkuId,
        provisionalUpdatedAt: anchor.provisionalUpdatedAt,
        quantityAvailable: sku.quantityAvailable,
        unitCost: sku.unitCost,
      };

      return {
        rowOrdinal,
        sourceRowKey: anchor.rowKey,
        sourceRowDigest: representative.sourceRowDigest,
        sourceRawValue: serializeRawValue(representative.rawValue),
        productSkuId: anchor.productSkuId,
        provisionalSkuId: anchor.provisionalSkuId,
        productName:
          sku.productName?.trim() || sku.sku?.trim() || "Inventory SKU",
        sku: sku.sku,
        barcode: sku.barcode,
        normalizedCostMinor,
        costOutcome: hasConflict
          ? "invalid_syntax"
          : representative.outcome.kind,
        provenanceDigest: digest(provenance),
        anchorDigest: digest({
          productSkuId: anchor.productSkuId,
          provisionalSkuIds: frozenLineages.map(
            (lineage) => lineage.provisionalSkuId,
          ),
        }),
        currentUnitCostMinor: sku.unitCost,
        preInventoryCount: sku.inventoryCount,
        preQuantityAvailable: sku.quantityAvailable,
        preCostedQuantity,
        preUncostedQuantity,
        preKnownCostPoolMinor,
        preCurrencyCode: position?.currencyCode,
        preCurrencyMinorUnitScale: position?.currencyMinorUnitScale,
        preProvisionalUpdatedAt: anchor.provisionalUpdatedAt,
        frozenLineages: frozenLineages.slice(0, MAX_FROZEN_LINEAGES_PER_SKU),
        frozenLineageDigest: digest(frozenLineages),
        lifecycle,
        eligibility,
        eligibilityReason,
        decision,
        frozenFingerprint: digest(frozen),
        prePositionVersion: position?.version,
      };
    });
}

async function loadSource(
  ctx: ActionCtx,
  runId: Id<"inventoryImportCostOverlayRun">,
  expectedEpoch: number,
) {
  const source = await ctx.runQuery(readReviewSource, { runId });
  if (source.rawContent !== undefined) {
    if (
      getUtf8ByteLength(source.rawContent) >
      INVENTORY_IMPORT_REVIEW_PAYLOAD_MAX_BYTES
    ) {
      throw new ConstructionScopeError();
    }
    await heartbeatConstructionOrThrow(ctx, { runId, expectedEpoch });
    return { content: source.rawContent, fileName: source.fileName };
  }
  if (
    (source.payloadChunkCount ?? 0) > INVENTORY_IMPORT_REVIEW_PAYLOAD_MAX_CHUNKS
  ) {
    throw new ConstructionScopeError();
  }
  const chunks: string[] = [];
  let totalBytes = 0;
  for (
    let chunkIndex = 0;
    chunkIndex < (source.payloadChunkCount ?? 0);
    chunkIndex += 1
  ) {
    const chunk = await ctx.runQuery(readReviewSourceChunk, {
      runId,
      chunkIndex,
    });
    if (!chunk) throw new Error("Saved review payload is incomplete.");
    if (chunk.kind === "raw_content") {
      const rawContent = chunk.rawContent ?? "";
      const chunkBytes = getUtf8ByteLength(rawContent);
      totalBytes += chunkBytes;
      if (
        chunkBytes > INVENTORY_IMPORT_REVIEW_PAYLOAD_CHUNK_MAX_BYTES ||
        totalBytes > INVENTORY_IMPORT_REVIEW_PAYLOAD_MAX_BYTES
      ) {
        throw new ConstructionScopeError();
      }
      chunks.push(rawContent);
    }
  }
  if (
    source.rawContentChunkCount !== undefined &&
    chunks.length !== source.rawContentChunkCount
  ) {
    throw new Error("Saved review payload is incomplete.");
  }
  await heartbeatConstructionOrThrow(ctx, { runId, expectedEpoch });
  return { content: chunks.join(""), fileName: source.fileName };
}

async function loadAnchors(
  ctx: ActionCtx,
  runId: Id<"inventoryImportCostOverlayRun">,
  expectedEpoch: number,
) {
  const anchors: ConstructionAnchor[] = [];
  let cursor: string | null = null;
  let pageCount = 0;
  do {
    const page: {
      page: ConstructionAnchor[];
      continueCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(readConstructionAnchors, {
      runId,
      paginationOpts: {
        cursor,
        numItems: COST_OVERLAY_CONSTRUCTION_ANCHOR_PAGE_SIZE,
      },
    });
    anchors.push(...page.page);
    if (anchors.length > COST_OVERLAY_CONSTRUCTION_ANCHOR_LIMIT) {
      throw new ConstructionScopeError();
    }
    pageCount += 1;
    if (pageCount % COST_OVERLAY_CONSTRUCTION_HEARTBEAT_PAGE_INTERVAL === 0) {
      await heartbeatConstructionOrThrow(ctx, {
        runId,
        expectedEpoch,
      });
    }
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor !== null);
  return anchors;
}

export const constructCostOverlayRun = internalAction({
  args: {
    runId: v.id("inventoryImportCostOverlayRun"),
    expectedEpoch: v.number(),
  },
  handler: async (ctx, args) => {
    const startingHeartbeat = await ctx.runMutation(heartbeatConstruction, {
      runId: args.runId,
      expectedEpoch: args.expectedEpoch,
    });
    if (startingHeartbeat.disposition === "stale") {
      return { disposition: "stale" as const };
    }
    const state = await ctx.runQuery(readConstructionState, {
      runId: args.runId,
    });
    if (
      state.status !== "draft" ||
      state.epoch !== args.expectedEpoch ||
      state.sourceProjectionVersion !==
        String(INVENTORY_IMPORT_SOURCE_PROJECTION_VERSION)
    ) {
      return { disposition: "stale" as const };
    }
    let loaded: Awaited<ReturnType<typeof loadSource>>;
    let anchors: ConstructionAnchor[];
    try {
      [loaded, anchors] = await Promise.all([
        loadSource(ctx, args.runId, args.expectedEpoch),
        loadAnchors(ctx, args.runId, args.expectedEpoch),
      ]);
    } catch (error) {
      if (error instanceof StaleConstructionError) {
        return { disposition: "stale" as const };
      }
      if (!(error instanceof ConstructionScopeError)) throw error;
      const result = await ctx.runMutation(abandonStaleConstruction, {
        runId: args.runId,
        expectedCursor: state.cursor,
        expectedEpoch: args.expectedEpoch,
        failureReason: CONSTRUCTION_SCOPE_TOO_LARGE,
      });
      return result.disposition === "abandoned"
        ? {
            disposition: "abandoned" as const,
            reason: CONSTRUCTION_SCOPE_TOO_LARGE,
          }
        : { disposition: "stale" as const };
    }
    const { content, fileName } = loaded;
    const rows = materializeCostOverlayRows({
      anchors,
      content,
      fileName,
      selectedColumn: state.selectedColumn,
      currencyMinorUnitScale: state.currencyMinorUnitScale,
    });
    const sourceDigest = digest({
      content,
      projectionVersion: state.sourceProjectionVersion,
      selectedColumn: state.selectedColumn,
    });
    const constructionSnapshotDigest = digest(
      rows.map(costOverlayConstructionIdentity),
    );
    if (
      state.cursor > 0 &&
      ((state.sourceDigest !== undefined &&
        state.sourceDigest !== sourceDigest) ||
        (state.constructionSnapshotDigest !== undefined &&
          state.constructionSnapshotDigest !== constructionSnapshotDigest) ||
        (state.constructionSnapshotRowCount !== undefined &&
          state.constructionSnapshotRowCount !== rows.length))
    ) {
      await ctx.runMutation(abandonStaleConstruction, {
        runId: args.runId,
        expectedCursor: state.cursor,
        expectedEpoch: args.expectedEpoch,
      });
      return { disposition: "stale" as const };
    }

    let cursor = state.cursor;
    const hasDurableSnapshot =
      state.sourceDigest !== undefined &&
      state.constructionSnapshotDigest !== undefined &&
      state.constructionSnapshotRowCount !== undefined;
    let prefixCursor = hasDurableSnapshot ? cursor : 0;
    if (prefixCursor < cursor) {
      const persisted = await ctx.runQuery(readConstructionPrefixBatch, {
        runId: args.runId,
        startOrdinal: prefixCursor,
      });
      if (
        persisted.length === 0 ||
        persisted.some((row, offset) => {
          const recomputed = rows[prefixCursor + offset];
          return (
            !recomputed ||
            row.rowOrdinal !== prefixCursor + offset ||
            costOverlayConstructionIdentity(row) !==
              costOverlayConstructionIdentity(recomputed)
          );
        })
      ) {
        await ctx.runMutation(abandonStaleConstruction, {
          runId: args.runId,
          expectedCursor: cursor,
          expectedEpoch: args.expectedEpoch,
        });
        return { disposition: "stale" as const };
      }
      prefixCursor += persisted.length;
    }
    if (prefixCursor !== cursor) {
      await ctx.runMutation(abandonStaleConstruction, {
        runId: args.runId,
        expectedCursor: cursor,
        expectedEpoch: args.expectedEpoch,
      });
      return { disposition: "stale" as const };
    }
    let committedBatches = 0;
    while (
      cursor < rows.length &&
      committedBatches < COST_OVERLAY_CONSTRUCTION_BATCHES_PER_INVOCATION
    ) {
      const batch = rows.slice(
        cursor,
        cursor + COST_OVERLAY_CONSTRUCTION_BATCH_SIZE,
      );
      const isDone = cursor + batch.length === rows.length;
      const result = await ctx.runMutation(appendConstructionBatch, {
        runId: args.runId,
        expectedEpoch: args.expectedEpoch,
        expectedCursor: cursor,
        rows: batch,
        isDone,
        sourceDigest,
        constructionSnapshotDigest,
        constructionSnapshotRowCount: rows.length,
      });
      cursor = result.cursor;
      committedBatches += 1;
    }
    if (rows.length === 0 && cursor === 0) {
      await ctx.runMutation(appendConstructionBatch, {
        runId: args.runId,
        expectedEpoch: args.expectedEpoch,
        expectedCursor: 0,
        rows: [],
        isDone: true,
        sourceDigest,
        constructionSnapshotDigest,
        constructionSnapshotRowCount: rows.length,
      });
    }
    if (cursor < rows.length) {
      await ctx.scheduler.runAfter(0, continueCostOverlayConstruction, {
        runId: args.runId,
        expectedEpoch: args.expectedEpoch,
      });
      return {
        disposition: "continued" as const,
        rowCount: rows.length,
        sourceFileName: loaded.fileName,
      };
    }
    return {
      disposition: "completed" as const,
      rowCount: rows.length,
      sourceFileName: loaded.fileName,
    };
  },
});
