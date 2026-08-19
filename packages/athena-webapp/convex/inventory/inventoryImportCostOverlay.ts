import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { OperationActor } from "../operationAdmission/types";
import {
  abandonCostOverlayRunOperationDefinition,
  confirmCostOverlayApplyOperationDefinition,
  createCostOverlayRunOperationDefinition,
  prepareCostOverlayRunOperationDefinition,
  requestCostOverlayUndoOperationDefinition,
  reopenCostOverlayRunOperationDefinition,
  retryCostOverlayWorkOperationDefinition,
  updateCostOverlayDecisionsBulkOperationDefinition,
  refreshCostOverlayUndoPreviewOperationDefinition,
  updateCostOverlayDecisionOperationDefinition,
} from "../operationAdmission/definitions";
import { requireOperationActorAthenaUserId } from "../operationAdmission/actors";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import {
  getCostOverlayRunReadDefinition,
  resolveCostOverlayRunFromUrlReadDefinition,
  getLatestCostOverlaySourceDescriptorReadDefinition,
  listRecentCostOverlayRunsReadDefinition,
  listCostOverlayRowsReadDefinition,
  getCostOverlayUndoPreviewReadDefinition,
} from "../operationAdmission/readDefinitions";
import { requireReportsStoreAccess } from "../reports/access";
import {
  inventoryImportCostOverlayColumnValidator,
  inventoryImportCostOverlayCommandDecisionValidator,
  inventoryImportCostOverlayRowInputValidator,
} from "../schemas/inventory";
import {
  INVENTORY_IMPORT_SOURCE_PROJECTION_VERSION,
  boundInventoryImportSourceColumns,
  interpretInventoryImportCost,
  projectInventoryImportSource,
} from "../../shared/inventoryImportSource";

type CostOverlayStatus =
  | "draft"
  | "ready"
  | "preparing"
  | "prepared"
  | "applying"
  | "applied"
  | "applied_with_exceptions"
  | "undoing"
  | "undone"
  | "undone_with_exceptions"
  | "abandoned";

type CostOverlayDecision =
  | "selected_missing_cost"
  | "overwrite_selected"
  | "not_selected"
  | "ineligible";

type CostOverlayCommandDecision = Exclude<CostOverlayDecision, "ineligible">;

export type CostOverlayRowFilter =
  "all" | "eligible" | "selected" | "different" | "exceptions";

const costOverlayRowFilterValidator = v.union(
  v.literal("all"),
  v.literal("eligible"),
  v.literal("selected"),
  v.literal("different"),
  v.literal("exceptions"),
);

export function costOverlayRowMatchesScope(
  row: Pick<
    Doc<"inventoryImportCostOverlayRow">,
    | "barcode"
    | "currentUnitCostMinor"
    | "decision"
    | "eligibility"
    | "normalizedCostMinor"
    | "productName"
    | "sku"
    | "sourceRowKey"
    | "workStatus"
  >,
  args: { filter?: CostOverlayRowFilter; search?: string },
) {
  const search = args.search?.trim().toLocaleLowerCase() ?? "";
  const matchesSearch =
    search.length === 0 ||
    [row.productName, row.sku, row.barcode, row.sourceRowKey].some((value) =>
      value?.toLocaleLowerCase().includes(search),
    );
  const filter = args.filter ?? "all";
  const matchesFilter =
    filter === "all" ||
    (filter === "eligible" && row.eligibility === "eligible") ||
    (filter === "selected" && isSelectedDecision(row.decision)) ||
    (filter === "different" &&
      row.currentUnitCostMinor !== undefined &&
      row.normalizedCostMinor !== undefined &&
      row.currentUnitCostMinor !== row.normalizedCostMinor) ||
    (filter === "exceptions" &&
      (row.eligibility === "ineligible" ||
        row.workStatus === "apply_exception" ||
        row.workStatus === "undo_exception"));
  return matchesSearch && matchesFilter;
}

type CostOverlayColumn =
  | { kind: "csv"; label: string; ordinal: number }
  | { kind: "json"; path: string };

const ACTIVE_COST_OVERLAY_STATUSES = [
  "draft",
  "ready",
  "preparing",
  "prepared",
  "applying",
  "undoing",
] as const;
const RECENT_COST_OVERLAY_RUN_LIMIT = 10;
const MAX_ACTIVE_COST_OVERLAY_RUNS_PER_STORE = 10;

const OWNED_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft: ["ready", "abandoned"],
  ready: ["preparing", "abandoned"],
  preparing: ["prepared"],
  prepared: ["ready", "abandoned"],
};

export function getCostOverlaySourceProjectionVersion() {
  return String(INVENTORY_IMPORT_SOURCE_PROJECTION_VERSION);
}

export function buildCostOverlayCreateRequestFingerprint(args: {
  reviewVersionId: string;
  selectedColumn: CostOverlayColumn;
}) {
  return JSON.stringify({
    reviewVersionId: args.reviewVersionId,
    selectedColumn: args.selectedColumn,
    sourceProjectionVersion: getCostOverlaySourceProjectionVersion(),
  });
}

export function buildCostOverlaySourceDescriptor(
  review: Pick<
    Doc<"inventoryImportReviewVersion">,
    | "_id"
    | "fileName"
    | "rawContent"
    | "rowCount"
    | "sourceColumns"
    | "sourceFormat"
    | "sourceProjectionVersion"
    | "versionNumber"
  >,
) {
  const legacyProjection =
    review.sourceColumns === undefined && review.rawContent !== undefined
      ? projectInventoryImportSource({
          content: review.rawContent,
          fileName: review.fileName,
        })
      : null;
  const columns =
    review.sourceColumns ??
    (legacyProjection
      ? boundInventoryImportSourceColumns(legacyProjection.columns)
      : []);
  return {
    reviewVersionId: review._id,
    versionNumber: review.versionNumber,
    fileName: review.fileName,
    sourceFormat: review.sourceFormat,
    rowCount: review.rowCount,
    columns: columns.map((column) => {
      const outcomes = column.sampleValues.map((sample) =>
        interpretInventoryImportCost(sample, { currencyScale: 2 }),
      );
      return {
        ...column,
        sampleValidity: column.costValidity ?? {
          valid: outcomes.filter((outcome) => outcome.kind === "valid").length,
          invalid: outcomes.filter((outcome) => outcome.kind !== "valid")
            .length,
        },
      };
    }),
    sourceProjectionVersion:
      review.sourceProjectionVersion ??
      legacyProjection?.version ??
      INVENTORY_IMPORT_SOURCE_PROJECTION_VERSION,
    descriptorStatus:
      columns.length > 0 ? ("available" as const) : ("unavailable" as const),
  };
}

export const COST_OVERLAY_RETRY_AFTER_MS = 60_000;

function costOverlayHeartbeat(
  run: Pick<
    Doc<"inventoryImportCostOverlayRun">,
    "updatedAt" | "workHeartbeatAt"
  >,
) {
  return run.workHeartbeatAt ?? run.updatedAt;
}

export function classifyCostOverlayRetryableWork(
  run: Pick<
    Doc<"inventoryImportCostOverlayRun">,
    | "bulkDecisionStatus"
    | "constructionComplete"
    | "status"
    | "updatedAt"
    | "workHeartbeatAt"
  >,
  now: number,
) {
  if (run.status === "ready" && run.bulkDecisionStatus === "processing") {
    return now - run.updatedAt >= COST_OVERLAY_RETRY_AFTER_MS
      ? ("bulk decision" as const)
      : null;
  }
  if (now - costOverlayHeartbeat(run) < COST_OVERLAY_RETRY_AFTER_MS)
    return null;
  if (run.status === "draft" && !run.constructionComplete) {
    return "construction" as const;
  }
  if (run.status === "preparing") return "preparation" as const;
  if (run.status === "applying") return "apply" as const;
  if (run.status === "undoing") return "undo" as const;
  return null;
}

export function assertCostOverlayTransition(
  current: CostOverlayStatus,
  next: CostOverlayStatus,
) {
  if (!OWNED_TRANSITIONS[current]?.includes(next)) {
    throw new Error("Invalid cost overlay lifecycle transition.");
  }
}

export function assertConstructionCheckpoint(args: {
  actualCursor: number;
  actualEpoch: number;
  expectedCursor: number;
  expectedEpoch: number;
  status: CostOverlayStatus;
}) {
  if (
    args.status !== "draft" ||
    args.actualCursor !== args.expectedCursor ||
    args.actualEpoch !== args.expectedEpoch
  ) {
    throw new Error("Cost overlay construction checkpoint is stale.");
  }
}

export function buildCostOverlayDecisionTransition(args: {
  currentDecision: CostOverlayDecision;
  currentRevision: number;
  nextDecision: CostOverlayDecision;
}) {
  const changed = args.currentDecision !== args.nextDecision;
  const decisionRevision = changed
    ? args.currentRevision + 1
    : args.currentRevision;
  return {
    changed,
    decision: args.nextDecision,
    decisionRevision,
    manifestDigest: undefined,
    preparedDecisionRevision: undefined,
    selectedCountDelta:
      Number(isSelectedDecision(args.nextDecision)) -
      Number(isSelectedDecision(args.currentDecision)),
    rowPatch: {
      decision: args.nextDecision,
      decisionRevision,
      manifestOrdinal: undefined,
      manifestEntryDigest: undefined,
    },
  };
}

function isSelectedDecision(decision: CostOverlayDecision) {
  return (
    decision === "selected_missing_cost" || decision === "overwrite_selected"
  );
}

function isCostOverlayCommandDecisionCompatible(
  row: Pick<
    Doc<"inventoryImportCostOverlayRow">,
    "currentUnitCostMinor" | "eligibility"
  >,
  decision: CostOverlayCommandDecision,
) {
  if (row.eligibility !== "eligible") return false;
  if (decision === "not_selected") return true;
  return row.currentUnitCostMinor === undefined
    ? decision === "selected_missing_cost"
    : decision === "overwrite_selected";
}

type OverlayReadCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

async function requireRunForStore(
  ctx: OverlayReadCtx,
  storeId: Id<"store">,
  runId: Id<"inventoryImportCostOverlayRun">,
) {
  const run = await ctx.db.get("inventoryImportCostOverlayRun", runId);
  if (!run || run.storeId !== storeId) {
    throw new Error("Cost overlay run unavailable.");
  }
  return run;
}

export async function scheduleCostOverlayContinuation(
  ctx: Pick<MutationCtx, "scheduler">,
  run: Pick<
    Doc<"inventoryImportCostOverlayRun">,
    | "_id"
    | "constructionComplete"
    | "epoch"
    | "preparedDecisionRevision"
    | "status"
  >,
) {
  if (run.status === "draft" && !run.constructionComplete) {
    await ctx.scheduler.runAfter(
      0,
      makeFunctionReference<
        "action",
        {
          runId: Id<"inventoryImportCostOverlayRun">;
          expectedEpoch: number;
        }
      >(
        "inventory/inventoryImportCostOverlayConstruction:constructCostOverlayRun",
      ),
      { runId: run._id, expectedEpoch: run.epoch },
    );
    return "construction" as const;
  }
  if (
    run.status === "preparing" &&
    run.preparedDecisionRevision !== undefined
  ) {
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
      {
        runId: run._id,
        expectedEpoch: run.epoch,
        expectedDecisionRevision: run.preparedDecisionRevision,
      },
    );
    return "preparation" as const;
  }
  const functionName =
    run.status === "applying"
      ? "processCostOverlayApplyBatch"
      : run.status === "undoing"
        ? "processCostOverlayUndoBatch"
        : null;
  if (!functionName) return null;
  await ctx.scheduler.runAfter(
    0,
    makeFunctionReference<
      "mutation",
      {
        runId: Id<"inventoryImportCostOverlayRun">;
        expectedEpoch: number;
      }
    >(`inventory/inventoryImportCostOverlayWork:${functionName}`),
    { runId: run._id, expectedEpoch: run.epoch },
  );
  return run.status === "applying" ? ("apply" as const) : ("undo" as const);
}

export async function resolveCostOverlayCreateReplay(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  run: Pick<
    Doc<"inventoryImportCostOverlayRun">,
    | "_id"
    | "constructionComplete"
    | "epoch"
    | "preparedDecisionRevision"
    | "requestFingerprint"
    | "status"
    | "updatedAt"
    | "workHeartbeatAt"
  >,
  requestFingerprint: string,
) {
  if (run.requestFingerprint !== requestFingerprint) {
    throw new Error("Cost overlay request key was reused.");
  }
  if (
    run.status === "draft" &&
    !run.constructionComplete &&
    classifyCostOverlayRetryableWork(run, Date.now()) === "construction"
  ) {
    const now = Date.now();
    const epoch = run.epoch + 1;
    await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
      epoch,
      updatedAt: now,
      workHeartbeatAt: now,
    });
    await scheduleCostOverlayContinuation(ctx, { ...run, epoch });
  }
  return { runId: run._id, status: run.status };
}

export function buildCostOverlayActorAuditFields(
  actor: OperationActor,
  action: "apply" | "undo",
) {
  const actorUserId = requireOperationActorAthenaUserId(actor);
  return action === "apply"
    ? { applyConfirmedByUserId: actorUserId }
    : { undoRequestedByUserId: actorUserId };
}

export function resolveCostOverlayAbandonResult(status: CostOverlayStatus) {
  if (status === "abandoned") return { status: "abandoned" as const };
  assertCostOverlayTransition(status, "abandoned");
  return null;
}

export function assertCostOverlayActiveRunCapacity(activeRunCount: number) {
  if (activeRunCount >= MAX_ACTIVE_COST_OVERLAY_RUNS_PER_STORE) {
    throw new Error(
      "Resolve an existing inventory cost overlay before starting another.",
    );
  }
}

async function listActiveCostOverlayRuns(
  ctx: OverlayReadCtx,
  storeId: Id<"store">,
) {
  const runsByStatus = await Promise.all(
    ACTIVE_COST_OVERLAY_STATUSES.map((status) =>
      ctx.db
        .query("inventoryImportCostOverlayRun")
        .withIndex("by_storeId_status_updatedAt", (q) =>
          q.eq("storeId", storeId).eq("status", status),
        )
        .order("desc")
        .take(MAX_ACTIVE_COST_OVERLAY_RUNS_PER_STORE + 1),
    ),
  );
  return runsByStatus.flat();
}

export const createCostOverlayRun = mutation({
  args: {
    storeId: v.id("store"),
    reviewVersionId: v.id("inventoryImportReviewVersion"),
    requestKey: v.string(),
    selectedColumn: inventoryImportCostOverlayColumnValidator,
  },
  handler: admitPublicMutation(
    createCostOverlayRunOperationDefinition,
    async (
      ctx,
      args: {
        storeId: Id<"store">;
        reviewVersionId: Id<"inventoryImportReviewVersion">;
        requestKey: string;
        selectedColumn: CostOverlayColumn;
      },
    ) => {
      const { athenaUser, store } = await requireReportsStoreAccess(
        ctx,
        args.storeId,
      );
      const reviewVersion = await ctx.db.get(
        "inventoryImportReviewVersion",
        args.reviewVersionId,
      );
      if (!reviewVersion || reviewVersion.storeId !== args.storeId) {
        throw new Error("Import review version unavailable.");
      }
      const requestFingerprint = buildCostOverlayCreateRequestFingerprint({
        reviewVersionId: args.reviewVersionId,
        selectedColumn: args.selectedColumn,
      });
      const replay = await ctx.db
        .query("inventoryImportCostOverlayRun")
        .withIndex("by_storeId_requestKey", (q) =>
          q.eq("storeId", args.storeId).eq("requestKey", args.requestKey),
        )
        .first();
      if (replay) {
        return await resolveCostOverlayCreateReplay(
          ctx,
          replay,
          requestFingerprint,
        );
      }
      assertCostOverlayActiveRunCapacity(
        (await listActiveCostOverlayRuns(ctx, args.storeId)).length,
      );
      const now = Date.now();
      const runId = await ctx.db.insert("inventoryImportCostOverlayRun", {
        storeId: args.storeId,
        organizationId: store.organizationId,
        reviewVersionId: args.reviewVersionId,
        reviewVersionNumber: reviewVersion.versionNumber,
        createdByUserId: athenaUser._id,
        requestKey: args.requestKey,
        requestFingerprint,
        selectedColumn: args.selectedColumn,
        sourceProjectionVersion: getCostOverlaySourceProjectionVersion(),
        currencyCode: store.currency?.trim().toUpperCase() || "GHS",
        currencyMinorUnitScale: 2,
        status: "draft",
        epoch: 1,
        workHeartbeatAt: now,
        constructionCursor: 0,
        constructionComplete: false,
        preparationCursor: 0,
        decisionRevision: 0,
        totalRowCount: 0,
        eligibleRowCount: 0,
        ineligibleRowCount: 0,
        selectedRowCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(
        0,
        makeFunctionReference<
          "action",
          {
            runId: Id<"inventoryImportCostOverlayRun">;
            expectedEpoch: number;
          }
        >(
          "inventory/inventoryImportCostOverlayConstruction:constructCostOverlayRun",
        ),
        { runId, expectedEpoch: 1 },
      );
      return { runId, status: "draft" as const };
    },
  ),
});

export const getCostOverlayRun = query({
  args: {
    storeId: v.id("store"),
    runId: v.id("inventoryImportCostOverlayRun"),
  },
  handler: admitPublicQuery(
    getCostOverlayRunReadDefinition,
    async (
      ctx,
      args: {
        storeId: Id<"store">;
        runId: Id<"inventoryImportCostOverlayRun">;
      },
    ) => {
      await requireReportsStoreAccess(ctx, args.storeId);
      const run = await requireRunForStore(ctx, args.storeId, args.runId);
      return {
        ...run,
        retryableWork: classifyCostOverlayRetryableWork(run, Date.now()),
      };
    },
  ),
});

export const resolveCostOverlayRunFromUrl = query({
  args: {
    storeId: v.id("store"),
    runId: v.string(),
  },
  handler: admitPublicQuery(
    resolveCostOverlayRunFromUrlReadDefinition,
    async (
      ctx,
      args: {
        storeId: Id<"store">;
        runId: string;
      },
    ) => {
      await requireReportsStoreAccess(ctx, args.storeId);
      const runId = ctx.db.normalizeId(
        "inventoryImportCostOverlayRun",
        args.runId.trim(),
      );
      if (!runId) return null;
      const run = await ctx.db.get("inventoryImportCostOverlayRun", runId);
      if (!run || run.storeId !== args.storeId) return null;
      return {
        ...run,
        retryableWork: classifyCostOverlayRetryableWork(run, Date.now()),
      };
    },
  ),
});

export const getLatestCostOverlaySourceDescriptor = query({
  args: { storeId: v.id("store") },
  handler: admitPublicQuery(
    getLatestCostOverlaySourceDescriptorReadDefinition,
    async (ctx, args: { storeId: Id<"store"> }) => {
      await requireReportsStoreAccess(ctx, args.storeId);
      const review = await ctx.db
        .query("inventoryImportReviewVersion")
        .withIndex("by_storeId_createdAt", (q) => q.eq("storeId", args.storeId))
        .order("desc")
        .first();
      if (!review) return null;
      return buildCostOverlaySourceDescriptor(review);
    },
  ),
});

export const listRecentCostOverlayRuns = query({
  args: { storeId: v.id("store") },
  handler: admitPublicQuery(
    listRecentCostOverlayRunsReadDefinition,
    async (ctx, args: { storeId: Id<"store"> }) => {
      await requireReportsStoreAccess(ctx, args.storeId);
      return await listRecentCostOverlayRunsWithActive(ctx, args.storeId);
    },
  ),
});

export async function listRecentCostOverlayRunsWithActive(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
) {
  const [recentRuns, activeRuns] = await Promise.all([
    ctx.db
      .query("inventoryImportCostOverlayRun")
      .withIndex("by_storeId_createdAt", (q) => q.eq("storeId", storeId))
      .order("desc")
      .take(RECENT_COST_OVERLAY_RUN_LIMIT),
    listActiveCostOverlayRuns(ctx, storeId),
  ]);
  const runsById = new Map(
    [...recentRuns, ...activeRuns].map((run) => [run._id, run]),
  );
  return [...runsById.values()].sort(
    (left, right) => right.createdAt - left.createdAt,
  );
}

export async function listCostOverlayRowsPageWithScope(
  ctx: Pick<QueryCtx, "db">,
  args: {
    runId: Id<"inventoryImportCostOverlayRun">;
    paginationOpts: { cursor: null | string; numItems: number };
    search?: string;
    filter?: CostOverlayRowFilter;
  },
) {
  const requested = Math.max(1, Math.min(args.paginationOpts.numItems, 100));
  const cursorPrefix = "inventory-cost-overlay-row:";
  const parsedCursor = args.paginationOpts.cursor?.startsWith(cursorPrefix)
    ? Number(args.paginationOpts.cursor.slice(cursorPrefix.length))
    : -1;
  const hasValidCursor =
    args.paginationOpts.cursor === null ||
    (args.paginationOpts.cursor.startsWith(cursorPrefix) &&
      Number.isSafeInteger(parsedCursor) &&
      parsedCursor >= -1);
  if (!hasValidCursor) {
    return {
      page: [],
      continueCursor: args.paginationOpts.cursor!,
      isDone: true,
    };
  }
  const afterRowOrdinal = parsedCursor;
  const scanLimit = Math.min(1_000, requested * 10);
  const scannedRows = await ctx.db
    .query("inventoryImportCostOverlayRow")
    .withIndex("by_runId_rowOrdinal", (q) => {
      const runRows = q.eq("runId", args.runId);
      return afterRowOrdinal >= 0
        ? runRows.gt("rowOrdinal", afterRowOrdinal)
        : runRows;
    })
    .take(scanLimit);
  const page: Doc<"inventoryImportCostOverlayRow">[] = [];
  let consumedCount = 0;
  let lastScannedRowOrdinal = afterRowOrdinal;
  for (const row of scannedRows) {
    consumedCount += 1;
    lastScannedRowOrdinal = row.rowOrdinal;
    if (costOverlayRowMatchesScope(row, args)) {
      page.push(row);
      if (page.length === requested) break;
    }
  }
  return {
    page,
    continueCursor: `${cursorPrefix}${lastScannedRowOrdinal}`,
    isDone:
      consumedCount === scannedRows.length && scannedRows.length < scanLimit,
  };
}

export const listCostOverlayRows = query({
  args: {
    storeId: v.id("store"),
    runId: v.id("inventoryImportCostOverlayRun"),
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    filter: v.optional(costOverlayRowFilterValidator),
  },
  handler: admitPublicQuery(
    listCostOverlayRowsReadDefinition,
    async (
      ctx,
      args: {
        storeId: Id<"store">;
        runId: Id<"inventoryImportCostOverlayRun">;
        paginationOpts: { cursor: null | string; numItems: number };
        search?: string;
        filter?: CostOverlayRowFilter;
      },
    ) => {
      await requireReportsStoreAccess(ctx, args.storeId);
      await requireRunForStore(ctx, args.storeId, args.runId);
      return listCostOverlayRowsPageWithScope(ctx, args);
    },
  ),
});

export const updateCostOverlayDecision = mutation({
  args: {
    storeId: v.id("store"),
    runId: v.id("inventoryImportCostOverlayRun"),
    rowId: v.id("inventoryImportCostOverlayRow"),
    decision: inventoryImportCostOverlayCommandDecisionValidator,
  },
  handler: admitPublicMutation(
    updateCostOverlayDecisionOperationDefinition,
    async (
      ctx,
      args: {
        storeId: Id<"store">;
        runId: Id<"inventoryImportCostOverlayRun">;
        rowId: Id<"inventoryImportCostOverlayRow">;
        decision: CostOverlayCommandDecision;
      },
    ) => {
      await requireReportsStoreAccess(ctx, args.storeId);
      const run = await requireRunForStore(ctx, args.storeId, args.runId);
      if (run.status !== "ready" || run.bulkDecisionStatus === "processing") {
        throw new Error("Cost overlay decisions are not editable.");
      }
      const row = await ctx.db.get("inventoryImportCostOverlayRow", args.rowId);
      if (!row || row.runId !== args.runId || row.storeId !== args.storeId) {
        throw new Error("Cost overlay row unavailable.");
      }
      if (row.eligibility === "ineligible") {
        throw new Error("Ineligible cost overlay rows cannot be changed.");
      }
      if (!isCostOverlayCommandDecisionCompatible(row, args.decision)) {
        throw new Error(
          "Cost overlay decision does not match the row's current-cost state.",
        );
      }
      const next = buildCostOverlayDecisionTransition({
        currentDecision: row.decision,
        currentRevision: run.decisionRevision,
        nextDecision: args.decision,
      });
      const result = {
        decision: next.decision,
        decisionRevision: next.decisionRevision,
        manifestDigest: next.manifestDigest,
        preparedDecisionRevision: next.preparedDecisionRevision,
      };
      if (!next.changed) return result;
      await ctx.db.patch("inventoryImportCostOverlayRow", args.rowId, {
        ...next.rowPatch,
        updatedAt: Date.now(),
      });
      await ctx.db.patch("inventoryImportCostOverlayRun", args.runId, {
        decisionRevision: next.decisionRevision,
        selectedRowCount: run.selectedRowCount + next.selectedCountDelta,
        manifestDigest: undefined,
        preparedDecisionRevision: undefined,
        updatedAt: Date.now(),
      });
      return result;
    },
  ),
});

export const updateCostOverlayDecisionsBulk = mutation({
  args: {
    storeId: v.id("store"),
    runId: v.id("inventoryImportCostOverlayRun"),
    search: v.optional(v.string()),
    filter: v.optional(costOverlayRowFilterValidator),
    decision: inventoryImportCostOverlayCommandDecisionValidator,
    requestKey: v.string(),
  },
  handler: admitPublicMutation(
    updateCostOverlayDecisionsBulkOperationDefinition,
    async (
      ctx,
      args: {
        storeId: Id<"store">;
        runId: Id<"inventoryImportCostOverlayRun">;
        search?: string;
        filter?: CostOverlayRowFilter;
        decision: CostOverlayCommandDecision;
        requestKey: string;
      },
    ) => {
      await requireReportsStoreAccess(ctx, args.storeId);
      const run = await requireRunForStore(ctx, args.storeId, args.runId);
      const filter = args.filter ?? "all";
      const search = args.search?.trim() ?? "";
      const fingerprint = JSON.stringify({
        decision: args.decision,
        filter,
        search,
      });
      const recorded = await ctx.db
        .query("inventoryImportCostOverlayBulkDecisionRequest")
        .withIndex("by_runId_requestKey", (q) =>
          q.eq("runId", run._id).eq("requestKey", args.requestKey),
        )
        .first();
      if (recorded) {
        if (recorded.requestFingerprint !== fingerprint) {
          throw new Error("Cost overlay bulk request key was reused.");
        }
        if (
          recorded.status === "processing" &&
          run.status === "ready" &&
          run.bulkDecisionStatus === "processing" &&
          run.bulkDecisionRequestKey === args.requestKey &&
          Date.now() - recorded.updatedAt >= COST_OVERLAY_RETRY_AFTER_MS
        ) {
          const now = Date.now();
          const generation = (recorded.generation ?? 1) + 1;
          await ctx.db.patch(
            "inventoryImportCostOverlayBulkDecisionRequest",
            recorded._id,
            { generation, updatedAt: now },
          );
          await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
            bulkDecisionGeneration: generation,
            updatedAt: now,
          });
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
              "inventory/inventoryImportCostOverlay:processCostOverlayBulkDecision",
            ),
            { generation, runId: run._id, requestKey: args.requestKey },
          );
        }
        return {
          status: recorded.status,
          updatedCount: recorded.updatedCount,
        };
      }
      if (run.status !== "ready") {
        throw new Error("Cost overlay decisions are not editable.");
      }
      if (run.bulkDecisionStatus === "processing") {
        throw new Error("A cost overlay bulk decision is already processing.");
      }
      const now = Date.now();
      await ctx.db.insert("inventoryImportCostOverlayBulkDecisionRequest", {
        runId: run._id,
        requestKey: args.requestKey,
        requestFingerprint: fingerprint,
        generation: 1,
        status: "processing",
        updatedCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
        bulkDecisionRequestKey: args.requestKey,
        bulkDecisionGeneration: 1,
        bulkDecisionCursor: 0,
        bulkDecisionStatus: "processing",
        bulkDecision: args.decision,
        bulkDecisionFilter: filter,
        bulkDecisionSearch: search,
        manifestDigest: undefined,
        preparedDecisionRevision: undefined,
        updatedAt: now,
      });
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
          "inventory/inventoryImportCostOverlay:processCostOverlayBulkDecision",
        ),
        { generation: 1, runId: run._id, requestKey: args.requestKey },
      );
      return { status: "processing" as const, updatedCount: 0 };
    },
  ),
});

export const processCostOverlayBulkDecision = internalMutation({
  args: {
    runId: v.id("inventoryImportCostOverlayRun"),
    requestKey: v.string(),
    generation: v.number(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("inventoryImportCostOverlayBulkDecisionRequest")
      .withIndex("by_runId_requestKey", (q) =>
        q.eq("runId", args.runId).eq("requestKey", args.requestKey),
      )
      .first();
    const run = await ctx.db.get("inventoryImportCostOverlayRun", args.runId);
    if (
      !request ||
      request.status !== "processing" ||
      (request.generation ?? 1) !== args.generation ||
      !run ||
      run.status !== "ready" ||
      run.bulkDecisionStatus !== "processing" ||
      run.bulkDecisionRequestKey !== args.requestKey ||
      (run.bulkDecisionGeneration ?? 1) !== args.generation ||
      !run.bulkDecision
    ) {
      return { disposition: "stale" as const };
    }
    const rows = await ctx.db
      .query("inventoryImportCostOverlayRow")
      .withIndex("by_runId_rowOrdinal", (q) =>
        q.eq("runId", run._id).gte("rowOrdinal", run.bulkDecisionCursor ?? 0),
      )
      .take(50);
    let selectedDelta = 0;
    let updatedCount = 0;
    let revision = run.decisionRevision;
    const now = Date.now();
    for (const row of rows) {
      if (
        !costOverlayRowMatchesScope(row, {
          filter: run.bulkDecisionFilter,
          search: run.bulkDecisionSearch,
        }) ||
        !isCostOverlayCommandDecisionCompatible(row, run.bulkDecision)
      ) {
        continue;
      }
      const transition = buildCostOverlayDecisionTransition({
        currentDecision: row.decision,
        currentRevision: run.decisionRevision,
        nextDecision: run.bulkDecision,
      });
      if (!transition.changed) continue;
      selectedDelta += transition.selectedCountDelta;
      updatedCount += 1;
      revision = transition.decisionRevision;
      await ctx.db.patch("inventoryImportCostOverlayRow", row._id, {
        ...transition.rowPatch,
        updatedAt: now,
      });
    }
    const nextCursor =
      rows.length === 0
        ? run.totalRowCount
        : rows[rows.length - 1].rowOrdinal + 1;
    const completed = rows.length < 50 || nextCursor >= run.totalRowCount;
    const totalUpdatedCount = request.updatedCount + updatedCount;
    await ctx.db.patch(
      "inventoryImportCostOverlayBulkDecisionRequest",
      request._id,
      {
        status: completed ? "completed" : "processing",
        updatedCount: totalUpdatedCount,
        completedAt: completed ? now : undefined,
        updatedAt: now,
      },
    );
    await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
      bulkDecisionCursor: nextCursor,
      bulkDecisionStatus: completed ? "completed" : "processing",
      decisionRevision: updatedCount > 0 ? revision : run.decisionRevision,
      manifestDigest: undefined,
      preparedDecisionRevision: undefined,
      selectedRowCount: run.selectedRowCount + selectedDelta,
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
          "inventory/inventoryImportCostOverlay:processCostOverlayBulkDecision",
        ),
        args,
      );
    }
    return {
      disposition: completed ? ("completed" as const) : ("continued" as const),
      updatedCount,
    };
  },
});

export const prepareCostOverlayRun = mutation({
  args: {
    storeId: v.id("store"),
    runId: v.id("inventoryImportCostOverlayRun"),
    expectedDecisionRevision: v.number(),
  },
  handler: admitPublicMutation(
    prepareCostOverlayRunOperationDefinition,
    async (
      ctx,
      args: {
        storeId: Id<"store">;
        runId: Id<"inventoryImportCostOverlayRun">;
        expectedDecisionRevision: number;
      },
    ) => {
      await requireReportsStoreAccess(ctx, args.storeId);
      const run = await requireRunForStore(ctx, args.storeId, args.runId);
      if (
        run.status !== "ready" ||
        run.bulkDecisionStatus === "processing" ||
        run.decisionRevision !== args.expectedDecisionRevision
      ) {
        throw new Error("Cost overlay preparation checkpoint is stale.");
      }
      assertCostOverlayTransition(run.status, "preparing");
      await ctx.db.patch("inventoryImportCostOverlayRun", args.runId, {
        status: "preparing",
        workHeartbeatAt: Date.now(),
        preparationCursor: 0,
        preparedDecisionRevision: args.expectedDecisionRevision,
        manifestDigest: "",
        selectedRowCount: 0,
        impactBeforeMinor: 0,
        impactAfterMinor: 0,
        updatedAt: Date.now(),
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
        >(
          "inventory/inventoryImportCostOverlayWork:prepareCostOverlayManifest",
        ),
        {
          runId: args.runId,
          expectedEpoch: run.epoch,
          expectedDecisionRevision: args.expectedDecisionRevision,
        },
      );
      return { status: "preparing" as const };
    },
  ),
});

export const confirmCostOverlayApply = mutation({
  args: {
    storeId: v.id("store"),
    runId: v.id("inventoryImportCostOverlayRun"),
    expectedManifestDigest: v.string(),
  },
  handler: admitPublicMutation(
    confirmCostOverlayApplyOperationDefinition,
    async (
      ctx,
      args: {
        storeId: Id<"store">;
        runId: Id<"inventoryImportCostOverlayRun">;
        expectedManifestDigest: string;
      },
    ) => {
      await requireReportsStoreAccess(ctx, args.storeId);
      const run = await requireRunForStore(ctx, args.storeId, args.runId);
      if (
        run.status !== "prepared" ||
        !run.manifestDigest ||
        run.manifestDigest !== args.expectedManifestDigest
      ) {
        throw new Error("Cost overlay apply confirmation is stale.");
      }
      const now = Date.now();
      const epoch = run.epoch + 1;
      await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
        ...buildCostOverlayActorAuditFields(
          ctx.operationAdmission.actor,
          "apply",
        ),
        appliedRowCount: 0,
        applyCursor: 0,
        applyExceptionCount: 0,
        applyRequestedAt: now,
        epoch,
        status: "applying",
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
          }
        >(
          "inventory/inventoryImportCostOverlayWork:processCostOverlayApplyBatch",
        ),
        { runId: run._id, expectedEpoch: epoch },
      );
      return { epoch, status: "applying" as const };
    },
  ),
});

export const getCostOverlayUndoPreview = query({
  args: {
    storeId: v.id("store"),
    runId: v.id("inventoryImportCostOverlayRun"),
  },
  handler: admitPublicQuery(
    getCostOverlayUndoPreviewReadDefinition,
    async (
      ctx,
      args: {
        storeId: Id<"store">;
        runId: Id<"inventoryImportCostOverlayRun">;
      },
    ) => {
      await requireReportsStoreAccess(ctx, args.storeId);
      const run = await requireRunForStore(ctx, args.storeId, args.runId);
      return {
        status: run.undoPreviewStatus ?? ("unavailable" as const),
        compensableCount: run.undoPreviewCompensableCount ?? 0,
        staleCount: run.undoPreviewStaleCount ?? 0,
        restoredCount: run.undoPreviewRestoredCount ?? 0,
        totalAppliedCount: run.appliedRowCount ?? 0,
        reasons: run.undoPreviewReasons ?? [],
        generatedAt: run.undoPreviewGeneratedAt,
      };
    },
  ),
});

export const refreshCostOverlayUndoPreview = mutation({
  args: {
    storeId: v.id("store"),
    runId: v.id("inventoryImportCostOverlayRun"),
    requestKey: v.string(),
  },
  handler: admitPublicMutation(
    refreshCostOverlayUndoPreviewOperationDefinition,
    async (ctx, args) => {
      await requireReportsStoreAccess(ctx, args.storeId);
      const run = await requireRunForStore(ctx, args.storeId, args.runId);
      if (
        run.status !== "applied" &&
        run.status !== "applied_with_exceptions"
      ) {
        throw new Error("Cost overlay undo preview is unavailable.");
      }
      if (run.undoPreviewRequestKey === args.requestKey) {
        if (
          run.undoPreviewStatus === "processing" &&
          Date.now() - (run.undoPreviewHeartbeatAt ?? run.updatedAt) >=
            COST_OVERLAY_RETRY_AFTER_MS
        ) {
          const now = Date.now();
          const generation = (run.undoPreviewGeneration ?? 1) + 1;
          await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
            undoPreviewGeneration: generation,
            undoPreviewHeartbeatAt: now,
            updatedAt: now,
          });
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
            { generation, runId: run._id, requestKey: args.requestKey },
          );
        }
        return { status: run.undoPreviewStatus ?? ("processing" as const) };
      }
      const now = Date.now();
      const generation = (run.undoPreviewGeneration ?? 0) + 1;
      await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
        undoPreviewRequestKey: args.requestKey,
        undoPreviewGeneration: generation,
        undoPreviewHeartbeatAt: now,
        undoPreviewCursor: 0,
        undoPreviewStatus: "processing",
        undoPreviewCompensableCount: 0,
        undoPreviewStaleCount: 0,
        undoPreviewRestoredCount: 0,
        undoPreviewReasons: [],
        undoPreviewGeneratedAt: undefined,
        updatedAt: now,
      });
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
        { generation, runId: run._id, requestKey: args.requestKey },
      );
      return { status: "processing" as const };
    },
  ),
});

export const requestCostOverlayUndo = mutation({
  args: {
    storeId: v.id("store"),
    runId: v.id("inventoryImportCostOverlayRun"),
    requestKey: v.string(),
  },
  handler: admitPublicMutation(
    requestCostOverlayUndoOperationDefinition,
    async (
      ctx,
      args: {
        storeId: Id<"store">;
        runId: Id<"inventoryImportCostOverlayRun">;
        requestKey: string;
      },
    ) => {
      await requireReportsStoreAccess(ctx, args.storeId);
      const run = await requireRunForStore(ctx, args.storeId, args.runId);
      const requestFingerprint = JSON.stringify({
        runId: run._id,
        operation: "inventory_cost_overlay_undo_v1",
      });
      if (run.undoRequestKey) {
        if (
          run.undoRequestKey !== args.requestKey ||
          run.undoRequestFingerprint !== requestFingerprint
        ) {
          throw new Error("Cost overlay undo request conflicts.");
        }
        return { epoch: run.epoch, status: run.status };
      }
      if (
        run.status !== "applying" &&
        run.status !== "applied" &&
        run.status !== "applied_with_exceptions"
      ) {
        throw new Error("Cost overlay run cannot be undone.");
      }
      const now = Date.now();
      const epoch = run.epoch + 1;
      await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
        epoch,
        status: "undoing",
        undoCursor: 0,
        undoExceptionCount: 0,
        undoRequestFingerprint: requestFingerprint,
        undoRequestKey: args.requestKey,
        ...buildCostOverlayActorAuditFields(
          ctx.operationAdmission.actor,
          "undo",
        ),
        undoRequestedAt: now,
        undoneRowCount: 0,
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
          }
        >(
          "inventory/inventoryImportCostOverlayWork:processCostOverlayUndoBatch",
        ),
        { runId: run._id, expectedEpoch: epoch },
      );
      return { epoch, status: "undoing" as const };
    },
  ),
});

export const retryCostOverlayWork = mutation({
  args: {
    storeId: v.id("store"),
    runId: v.id("inventoryImportCostOverlayRun"),
  },
  handler: admitPublicMutation(
    retryCostOverlayWorkOperationDefinition,
    async (
      ctx,
      args: {
        storeId: Id<"store">;
        runId: Id<"inventoryImportCostOverlayRun">;
      },
    ) => {
      await requireReportsStoreAccess(ctx, args.storeId);
      const run = await requireRunForStore(ctx, args.storeId, args.runId);
      const retryableWork = classifyCostOverlayRetryableWork(run, Date.now());
      if (!retryableWork) {
        throw new Error(
          "Cost overlay work is still active or cannot be retried.",
        );
      }
      const now = Date.now();
      if (retryableWork === "bulk decision") {
        const requestKey = run.bulkDecisionRequestKey;
        if (!requestKey) {
          throw new Error("Cost overlay run has no interrupted work to retry.");
        }
        const request = await ctx.db
          .query("inventoryImportCostOverlayBulkDecisionRequest")
          .withIndex("by_runId_requestKey", (q) =>
            q.eq("runId", run._id).eq("requestKey", requestKey),
          )
          .first();
        const generation = request?.generation ?? 1;
        if (
          !request ||
          request.status !== "processing" ||
          generation !== (run.bulkDecisionGeneration ?? 1) ||
          now - request.updatedAt < COST_OVERLAY_RETRY_AFTER_MS
        ) {
          throw new Error(
            "Cost overlay work is still active or cannot be retried.",
          );
        }
        const nextGeneration = generation + 1;
        await ctx.db.patch(
          "inventoryImportCostOverlayBulkDecisionRequest",
          request._id,
          {
            generation: nextGeneration,
            updatedAt: now,
          },
        );
        await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
          bulkDecisionGeneration: nextGeneration,
          updatedAt: now,
        });
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
            "inventory/inventoryImportCostOverlay:processCostOverlayBulkDecision",
          ),
          {
            generation: nextGeneration,
            runId: run._id,
            requestKey,
          },
        );
        return {
          epoch: run.epoch,
          status: run.status,
          work: retryableWork,
        };
      }
      const epoch = run.epoch + 1;
      await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
        epoch,
        updatedAt: now,
        workHeartbeatAt: now,
      });
      const continuation = await scheduleCostOverlayContinuation(ctx, {
        ...run,
        epoch,
      });
      if (!continuation) {
        throw new Error("Cost overlay run has no interrupted work to retry.");
      }
      return { epoch, status: run.status, work: retryableWork };
    },
  ),
});

export const reopenCostOverlayRun = mutation({
  args: {
    storeId: v.id("store"),
    runId: v.id("inventoryImportCostOverlayRun"),
  },
  handler: admitPublicMutation(
    reopenCostOverlayRunOperationDefinition,
    async (
      ctx,
      args: {
        storeId: Id<"store">;
        runId: Id<"inventoryImportCostOverlayRun">;
      },
    ) => {
      await requireReportsStoreAccess(ctx, args.storeId);
      const run = await requireRunForStore(ctx, args.storeId, args.runId);
      assertCostOverlayTransition(run.status, "ready");
      await ctx.db.patch("inventoryImportCostOverlayRun", args.runId, {
        status: "ready",
        epoch: run.epoch + 1,
        preparationCursor: 0,
        preparedDecisionRevision: undefined,
        manifestDigest: undefined,
        impactBeforeMinor: undefined,
        impactAfterMinor: undefined,
        largestImpacts: undefined,
        preparedAt: undefined,
        updatedAt: Date.now(),
      });
      return { status: "ready" as const };
    },
  ),
});

export const abandonCostOverlayRun = mutation({
  args: {
    storeId: v.id("store"),
    runId: v.id("inventoryImportCostOverlayRun"),
  },
  handler: admitPublicMutation(
    abandonCostOverlayRunOperationDefinition,
    async (
      ctx,
      args: {
        storeId: Id<"store">;
        runId: Id<"inventoryImportCostOverlayRun">;
      },
    ) => {
      await requireReportsStoreAccess(ctx, args.storeId);
      const run = await requireRunForStore(ctx, args.storeId, args.runId);
      if (run.bulkDecisionStatus === "processing") {
        throw new Error("Cost overlay bulk decision is still processing.");
      }
      const terminalResult = resolveCostOverlayAbandonResult(run.status);
      if (terminalResult) return terminalResult;
      const now = Date.now();
      await ctx.db.patch("inventoryImportCostOverlayRun", args.runId, {
        status: "abandoned",
        epoch: run.epoch + 1,
        abandonedAt: now,
        updatedAt: now,
        workHeartbeatAt: now,
      });
      return { status: "abandoned" as const };
    },
  ),
});

export const readCostOverlayConstructionState = internalQuery({
  args: { runId: v.id("inventoryImportCostOverlayRun") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("inventoryImportCostOverlayRun", args.runId);
    if (!run) throw new Error("Cost overlay run unavailable.");
    return {
      runId: run._id,
      reviewVersionId: run.reviewVersionId,
      selectedColumn: run.selectedColumn,
      sourceProjectionVersion: run.sourceProjectionVersion,
      currencyMinorUnitScale: run.currencyMinorUnitScale,
      epoch: run.epoch,
      cursor: run.constructionCursor,
      sourceDigest: run.sourceDigest,
      constructionSnapshotDigest: run.constructionSnapshotDigest,
      constructionSnapshotRowCount: run.constructionSnapshotRowCount,
      status: run.status,
    };
  },
});

export const heartbeatCostOverlayConstruction = internalMutation({
  args: {
    runId: v.id("inventoryImportCostOverlayRun"),
    expectedEpoch: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("inventoryImportCostOverlayRun", args.runId);
    if (
      !run ||
      run.status !== "draft" ||
      run.epoch !== args.expectedEpoch ||
      run.constructionComplete
    ) {
      return { disposition: "stale" as const };
    }
    await ctx.db.patch("inventoryImportCostOverlayRun", run._id, {
      workHeartbeatAt: Date.now(),
    });
    return { disposition: "active" as const };
  },
});

export const readCostOverlayReviewSource = internalQuery({
  args: { runId: v.id("inventoryImportCostOverlayRun") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("inventoryImportCostOverlayRun", args.runId);
    if (!run || run.status !== "draft") {
      throw new Error("Cost overlay construction checkpoint is stale.");
    }
    const review = await ctx.db.get(
      "inventoryImportReviewVersion",
      run.reviewVersionId,
    );
    if (!review || review.storeId !== run.storeId) {
      throw new Error("Import review version unavailable.");
    }
    return {
      fileName: review.fileName,
      payloadChunkCount: review.payloadChunkCount,
      rawContent: review.rawContent,
      rawContentChunkCount: review.rawContentChunkCount,
    };
  },
});

export const readCostOverlayReviewSourceChunk = internalQuery({
  args: {
    runId: v.id("inventoryImportCostOverlayRun"),
    chunkIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("inventoryImportCostOverlayRun", args.runId);
    if (!run || run.status !== "draft") {
      throw new Error("Cost overlay construction checkpoint is stale.");
    }
    const chunk = await ctx.db
      .query("inventoryImportReviewVersionPayloadChunk")
      .withIndex("by_reviewVersionId_chunkIndex", (q) =>
        q
          .eq("reviewVersionId", run.reviewVersionId)
          .eq("chunkIndex", args.chunkIndex),
      )
      .unique();
    if (!chunk) return null;
    return chunk.kind === "raw_content"
      ? { kind: chunk.kind, rawContent: chunk.rawContent }
      : { kind: chunk.kind };
  },
});

export const readCostOverlayConstructionAnchors = internalQuery({
  args: {
    runId: v.id("inventoryImportCostOverlayRun"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("inventoryImportCostOverlayRun", args.runId);
    if (!run || run.status !== "draft") {
      throw new Error("Cost overlay construction checkpoint is stale.");
    }
    const page = await ctx.db
      .query("inventoryImportProvisionalSku")
      .withIndex("by_storeId", (q) => q.eq("storeId", run.storeId))
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(args.paginationOpts.numItems, 100),
      });
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (row) => {
          const sku = row.productSkuId
            ? await ctx.db.get("productSku", row.productSkuId)
            : null;
          const position =
            row.productSkuId && sku?.storeId === run.storeId
              ? await ctx.db
                  .query("reportingInventoryPosition")
                  .withIndex("by_storeId_productSkuId", (q) =>
                    q
                      .eq("storeId", run.storeId)
                      .eq("productSkuId", row.productSkuId!),
                  )
                  .unique()
              : null;
          return {
            provisionalSkuId: row._id,
            productSkuId: row.productSkuId,
            rowKey: row.rowKey,
            rowNumber: row.rowNumber,
            status: row.status,
            finalizedAt: row.finalizedAt,
            provisionalUpdatedAt: row.updatedAt,
            ...(sku && sku.storeId === run.storeId
              ? {
                  sku: {
                    barcode: sku.barcode,
                    inventoryCount: sku.inventoryCount,
                    productName: sku.productName,
                    quantityAvailable: sku.quantityAvailable,
                    sku: sku.sku,
                    unitCost: sku.unitCost,
                    updatedAt: (
                      sku as Doc<"productSku"> & {
                        updatedAt?: number;
                      }
                    ).updatedAt,
                  },
                }
              : {}),
            ...(position
              ? {
                  position: {
                    costedQuantity: position.costedQuantity,
                    currencyCode: position.currencyCode,
                    currencyMinorUnitScale: position.currencyMinorUnitScale,
                    knownCostPoolMinor: position.knownCostPoolMinor,
                    uncostedQuantity: position.uncostedQuantity,
                    version: position.version,
                  },
                }
              : {}),
          };
        }),
      ),
    };
  },
});

export const appendCostOverlayConstructionBatch = internalMutation({
  args: {
    runId: v.id("inventoryImportCostOverlayRun"),
    expectedEpoch: v.number(),
    expectedCursor: v.number(),
    rows: v.array(inventoryImportCostOverlayRowInputValidator),
    isDone: v.boolean(),
    sourceDigest: v.optional(v.string()),
    constructionSnapshotDigest: v.string(),
    constructionSnapshotRowCount: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.rows.length > 100) {
      throw new Error("Cost overlay construction batch exceeds 100 rows.");
    }
    if (!args.sourceDigest?.trim()) {
      throw new Error("Cost overlay construction needs a source digest.");
    }
    const run = await ctx.db.get("inventoryImportCostOverlayRun", args.runId);
    if (!run) throw new Error("Cost overlay run unavailable.");
    assertConstructionCheckpoint({
      actualCursor: run.constructionCursor,
      actualEpoch: run.epoch,
      expectedCursor: args.expectedCursor,
      expectedEpoch: args.expectedEpoch,
      status: run.status,
    });
    if (
      run.sourceDigest !== undefined &&
      run.sourceDigest !== args.sourceDigest
    ) {
      throw new Error("Cost overlay construction source changed.");
    }
    if (
      run.constructionSnapshotDigest !== undefined &&
      run.constructionSnapshotDigest !== args.constructionSnapshotDigest
    ) {
      throw new Error("Cost overlay construction snapshot changed.");
    }
    if (
      run.constructionSnapshotRowCount !== undefined &&
      run.constructionSnapshotRowCount !== args.constructionSnapshotRowCount
    ) {
      throw new Error("Cost overlay construction snapshot changed.");
    }
    let eligible = 0;
    let selected = 0;
    for (const [offset, row] of args.rows.entries()) {
      if (row.rowOrdinal !== args.expectedCursor + offset) {
        throw new Error("Cost overlay row ordinal is not contiguous.");
      }
      if (row.eligibility === "eligible") eligible += 1;
      if (
        row.decision === "selected_missing_cost" ||
        row.decision === "overwrite_selected"
      ) {
        selected += 1;
      }
      const now = Date.now();
      await ctx.db.insert("inventoryImportCostOverlayRow", {
        ...row,
        runId: args.runId,
        storeId: run.storeId,
        organizationId: run.organizationId,
        decisionRevision: run.decisionRevision,
        createdAt: now,
        updatedAt: now,
      });
    }
    const cursor = args.expectedCursor + args.rows.length;
    const nextStatus = args.isDone ? "ready" : "draft";
    if (args.isDone) assertCostOverlayTransition(run.status, nextStatus);
    await ctx.db.patch("inventoryImportCostOverlayRun", args.runId, {
      constructionCursor: cursor,
      constructionComplete: args.isDone,
      sourceDigest: args.sourceDigest,
      constructionSnapshotDigest: args.constructionSnapshotDigest,
      constructionSnapshotRowCount: args.constructionSnapshotRowCount,
      status: nextStatus,
      totalRowCount: run.totalRowCount + args.rows.length,
      eligibleRowCount: run.eligibleRowCount + eligible,
      ineligibleRowCount: run.ineligibleRowCount + args.rows.length - eligible,
      selectedRowCount: run.selectedRowCount + selected,
      updatedAt: Date.now(),
      workHeartbeatAt: Date.now(),
    });
    return { cursor, status: nextStatus };
  },
});
