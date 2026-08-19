import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  REPORTS_FOLD_VERSION,
  REPORT_MOVEMENT_CONTRACT_VERSION,
  REPORT_MOVEMENT_PAGE_SIZE,
  REPORT_MOVEMENT_RANGE_MAX_DAYS,
  computeMovementRequestKey,
  deriveMovementRequestLifecycle,
  movementAbsNetUnitsSortKey,
  movementPageCount,
  movementSourceRowMatchesRevision,
  validateReportRangeRequest,
  type ReportMovementDayRevision,
  type ReportMovementLifecycle,
  type ReportMovementTotals,
  type ReportSkuMovementRow,
} from "../../shared/reportsContract";
import { requireReportsStoreAccess } from "./access";
import {
  ensureMovementRangeOperationDefinition,
  retryMovementRangeOperationDefinition,
} from "../operationAdmission/domains/reports_definitions";
import {
  getMovementRangeReadDefinition,
  getMovementRangePageReadDefinition,
} from "../operationAdmission/domains/reports_readDefinitions";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import type {
  OperationMutationCtx,
  OperationQueryCtx,
} from "../operationAdmission/types";
import { stableStringHash } from "./fingerprint";
import { resolveSkuIdentity } from "./queries";
import {
  ensureRangeSnapshotCore,
  readableRangeSnapshotHeader,
  readRangeRevisionVector,
  recordRangeSnapshotWorkerFailureCore,
  rangeSnapshotRetryBackoffMs,
  retryTerminalRangeSnapshot,
  runRangeSnapshotBatchCore,
  tryConsumeRangeSnapshotAdmission,
  type RangeSnapshotAdmissionSnapshot,
  type RangeSnapshotBatchIntent,
  type RangeSnapshotKindConfig,
  type RangeSnapshotRankingOutcome,
} from "./rangeSnapshotLifecycle";

/**
 * The SKU-movement range lifecycle — the first consumer of the kind-generic
 * bounded-resumable-range-snapshot machinery in
 * `reports/rangeSnapshotLifecycle.ts` (U3), and the module that originally
 * established it.
 *
 * One admitted request is one immutable snapshot: its identity (the
 * "movement:" request key) folds in store, range, fold/contract versions, and
 * the certified revision of every included operating day. A private worker
 * action drives resumable, fenced batches — reset → aggregate one operating
 * day at a time → rank in bounded index intervals → recheck the revision
 * vector → publish — and the sweeper's unconditional backstop rescues any
 * dropped continuation through the global `by_movementEligibleAt` index.
 *
 * All of that ordering, fencing, retry, scheduling, and cleanup behavior is
 * the generic lifecycle's; this module contributes movement's per-kind
 * configuration (`MOVEMENT_RANGE_SNAPSHOT_KIND`): the reportSkuDay source
 * projection into `reportRangeMovementSku` children, the ranking phase and
 * its totals accumulator, the movement constants, and the public
 * ensure/retry/read boundary.
 *
 * Division of responsibility with the sweeper (see sweeper.ts's header):
 * declarative dirty marks own FOLDS; this lifecycle owns its own eligible-
 * work queue plus a cron backstop that only SCHEDULES — the broad sweep
 * mutation never aggregates movement rows inline.
 */

// ---------------------------------------------------------------------------
// Named constants. Every batch, admission, backoff, and cleanup bound the
// movement lifecycle uses lives here, beside the config that consumes it.
// ---------------------------------------------------------------------------

/** Per-day source rows one aggregation batch may read. Mirrors the fold's
 * MAX_SKU_DAY_ROWS_PER_DAY cap — a certified day can never exceed it. */
export const MOVEMENT_SOURCE_DAY_ROW_CAP = 2000;
/** Stale children deleted per reset ("queued") batch before re-aggregation. */
export const MOVEMENT_RESET_CHILD_BATCH = 500;
/** Child rows assigned an ordinal rank per ranking batch. */
export const MOVEMENT_RANK_BATCH = 200;

/** Worker failures tolerated before the request goes terminal. */
export const MOVEMENT_MAX_ATTEMPTS = 5;
/** Retry backoff: base doubling per attempt, capped. */
export const MOVEMENT_RETRY_BASE_MS = 30_000;
export const MOVEMENT_RETRY_MAX_MS = 10 * 60_000;
/** An active row untouched for this long is considered a dropped
 * continuation; the sweeper backstop reschedules it. */
export const MOVEMENT_STALL_RECOVERY_MS = 10 * 60_000;

/** Server-chosen ensure polling intervals (plus jitter, so many open sheets
 * cannot align into a retry storm). */
export const MOVEMENT_WAITING_RETRY_MS = 15_000;
export const MOVEMENT_BACKPRESSURE_RETRY_MS = 10_000;
export const MOVEMENT_RETRY_JITTER_MS = 5_000;

/** Fixed admission window and its per-scope budgets (new admissions only —
 * reusing an existing request never consumes budget). */
export const MOVEMENT_ADMISSION_WINDOW_MS = 10 * 60_000;
export const MOVEMENT_ADMISSIONS_PER_PRINCIPAL = 4;
export const MOVEMENT_ADMISSIONS_PER_STORE = 8;
export const MOVEMENT_ADMISSIONS_GLOBAL = 20;

/** Shared-scan sweep budgets — owned by the generic lifecycle, re-exported
 * here under their historical movement names. */
export {
  RANGE_SNAPSHOT_BACKSTOP_SCHEDULES_PER_TICK as MOVEMENT_BACKSTOP_SCHEDULES_PER_TICK,
  RANGE_SNAPSHOT_CLEANUP_HEADER_BATCH as MOVEMENT_CLEANUP_HEADER_BATCH,
} from "./rangeSnapshotLifecycle";
/** Expired child rows deleted per sweep tick (child-first cleanup). */
export const MOVEMENT_CLEANUP_CHILD_BATCH = 1500;

/**
 * Steady-state sizing inputs for the cleanup budget. The sweeper runs every
 * five minutes (convex/crons.ts); at the assumed steady-state request volume
 * and the fold's 2,000-row/day child ceiling, per-day cleanup capacity must
 * exceed per-day child creation — asserted in skuMovementRange.test.ts.
 */
export const REPORTS_SWEEP_INTERVAL_MS = 5 * 60_000;
export const MOVEMENT_STEADY_STATE_REQUESTS_PER_DAY = 200;
export const MOVEMENT_STEADY_STATE_CHILDREN_PER_REQUEST = 2000;

/** Sanitized terminal codes — the only error identities a client ever sees. */
export const MOVEMENT_ERROR_CODE_WORKER_FAILED = "movement_worker_failed";
export const MOVEMENT_ERROR_CODE_SOURCE_STALE = "movement_source_stale";

// ---------------------------------------------------------------------------
// Function references for the continuation chain. Built by path rather than
// read off `internal.reports.skuMovementRange` because _generated/api.d.ts is
// regenerated at deploy time and predates this module (same staleness the
// reseed chain documents at RESEED_SELF_REF). The path string is what the
// runtime uses either way.
// ---------------------------------------------------------------------------

const MOVEMENT_WORKER_REF = makeFunctionReference<
  "action",
  {
    rangeResultId: Id<"reportRangeResult">;
    expectedPhase: string;
    expectedFence: number;
  }
>("reports/skuMovementRange:runMovementWorker");

const MOVEMENT_BATCH_REF = makeFunctionReference<
  "mutation",
  {
    rangeResultId: Id<"reportRangeResult">;
    expectedPhase: string;
    expectedFence: number;
  },
  MovementBatchIntent
>("reports/skuMovementRange:runMovementBatch");

const MOVEMENT_FAILURE_REF = makeFunctionReference<
  "mutation",
  { rangeResultId: Id<"reportRangeResult">; expectedFence: number },
  { recorded: boolean; correlationId?: string }
>("reports/skuMovementRange:recordMovementWorkerFailure");

// ---------------------------------------------------------------------------
// Movement's kind-specific seams: the source projection into the
// `reportRangeMovementSku` child table, the ranking pass, and child
// bookkeeping. Everything else — gate ordering, fencing, retry, scheduling,
// backstop, cleanup — is the generic lifecycle acting on the config below.
// ---------------------------------------------------------------------------

const ZERO_TOTALS: ReportMovementTotals = {
  unitsSold: 0,
  unitsReturned: 0,
  netUnits: 0,
  skuCount: 0,
};

/**
 * Aggregate one admitted operating day: bounded reportSkuDay read, per-row
 * revision match, and child upserts. The generic machinery has already
 * verified the day is neither dirty nor on a different certified revision.
 */
async function aggregateMovementSourceDay(
  ctx: MutationCtx,
  row: Doc<"reportRangeResult">,
  expected: ReportMovementDayRevision,
): Promise<"ok" | "source_stale"> {
  const operatingDate = expected.operatingDate;
  const sourceRows = await ctx.db
    .query("reportSkuDay")
    .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
      q.eq("storeId", row.storeId).eq("operatingDate", operatingDate),
    )
    .take(MOVEMENT_SOURCE_DAY_ROW_CAP + 1);
  if (sourceRows.length > MOVEMENT_SOURCE_DAY_ROW_CAP) {
    // A certified day cannot exceed the fold cap; this is a defect,
    // and the action's failure lane owns it.
    throw new Error(
      `movement source day ${operatingDate} exceeds the row cap`,
    );
  }
  for (const source of sourceRows) {
    if (!movementSourceRowMatchesRevision(expected.revision, source)) {
      return "source_stale";
    }
    const child = await ctx.db
      .query("reportRangeMovementSku")
      .withIndex("by_storeId_rangeResultId_productSkuId", (q) =>
        q
          .eq("storeId", row.storeId)
          .eq("rangeResultId", row._id)
          .eq("productSkuId", source.productSkuId),
      )
      .unique();
    const unitsSold = (child?.unitsSold ?? 0) + source.unitsSold;
    const unitsReturned = (child?.unitsReturned ?? 0) + source.unitsReturned;
    const netUnits = unitsSold - unitsReturned;
    if (child) {
      await ctx.db.patch("reportRangeMovementSku", child._id, {
        unitsSold,
        unitsReturned,
        netUnits,
        absNetUnitsSortKey: movementAbsNetUnitsSortKey(netUnits),
      });
    } else {
      await ctx.db.insert("reportRangeMovementSku", {
        storeId: row.storeId,
        rangeResultId: row._id,
        productSkuId: source.productSkuId,
        unitsSold,
        unitsReturned,
        netUnits,
        absNetUnitsSortKey: movementAbsNetUnitsSortKey(netUnits),
        expiresAt: row.expiresAt,
      });
    }
  }
  return "ok";
}

/**
 * One bounded ranking batch: resume off the highest already-assigned rank,
 * continue exactly over the compound ordering index, and accumulate the
 * running totals that finalization publishes.
 */
async function runMovementRankingBatch(
  ctx: MutationCtx,
  row: Doc<"reportRangeResult">,
): Promise<RangeSnapshotRankingOutcome> {
  // Resume point: the highest already-assigned rank. `rank` is optional
  // and undefined sorts first ascending, so descending-first yields the
  // top ranked row when any rank exists.
  const top = await ctx.db
    .query("reportRangeMovementSku")
    .withIndex("by_storeId_rangeResultId_rank", (q) =>
      q.eq("storeId", row.storeId).eq("rangeResultId", row._id),
    )
    .order("desc")
    .first();
  const resume =
    top && top.rank !== undefined
      ? {
          sortKey: top.absNetUnitsSortKey,
          skuId: top.productSkuId,
          nextRank: top.rank + 1,
        }
      : null;

  // Exact continuation over the compound ordering index: the remainder
  // of the resume sort-key group first, then strictly-greater keys.
  let batch: Doc<"reportRangeMovementSku">[];
  if (!resume) {
    batch = await ctx.db
      .query("reportRangeMovementSku")
      .withIndex(
        "by_storeId_rangeResultId_absNetUnitsSortKey_productSkuId",
        (q) => q.eq("storeId", row.storeId).eq("rangeResultId", row._id),
      )
      .take(MOVEMENT_RANK_BATCH);
  } else {
    const sameKey = await ctx.db
      .query("reportRangeMovementSku")
      .withIndex(
        "by_storeId_rangeResultId_absNetUnitsSortKey_productSkuId",
        (q) =>
          q
            .eq("storeId", row.storeId)
            .eq("rangeResultId", row._id)
            .eq("absNetUnitsSortKey", resume.sortKey)
            .gt("productSkuId", resume.skuId),
      )
      .take(MOVEMENT_RANK_BATCH);
    const after =
      sameKey.length < MOVEMENT_RANK_BATCH
        ? await ctx.db
            .query("reportRangeMovementSku")
            .withIndex(
              "by_storeId_rangeResultId_absNetUnitsSortKey_productSkuId",
              (q) =>
                q
                  .eq("storeId", row.storeId)
                  .eq("rangeResultId", row._id)
                  .gt("absNetUnitsSortKey", resume.sortKey),
            )
            .take(MOVEMENT_RANK_BATCH - sameKey.length)
        : [];
    batch = [...sameKey, ...after];
  }

  const totals = { ...(row.movementTotals ?? ZERO_TOTALS) };
  let nextRank = resume?.nextRank ?? 1;
  for (const child of batch) {
    await ctx.db.patch("reportRangeMovementSku", child._id, {
      rank: nextRank,
    });
    nextRank += 1;
    totals.unitsSold += child.unitsSold;
    totals.unitsReturned += child.unitsReturned;
    totals.netUnits += child.netUnits;
    totals.skuCount += 1;
  }

  if (batch.length === MOVEMENT_RANK_BATCH) {
    // Running accumulator; authoritative only once finalization publishes.
    return { done: false, headerPatch: { movementTotals: totals } };
  }
  return { done: true, completionPatch: { movementTotals: totals } };
}

/**
 * Movement's per-kind lifecycle configuration — the exact seam U4's mix kind
 * mirrors. `admissionKeyScope` is "" because movement's production admission
 * buckets predate kind scoping (see the config type's field doc for the
 * grandfathering and no-migration rationale); every later kind uses its own
 * kind string.
 */
export const MOVEMENT_RANGE_SNAPSHOT_KIND: RangeSnapshotKindConfig<ReportMovementLifecycle> =
  {
    kind: "sku_movement",
    contractVersion: REPORT_MOVEMENT_CONTRACT_VERSION,
    maxRangeDays: REPORT_MOVEMENT_RANGE_MAX_DAYS,
    hasRankingPhase: true,
    workerRef: MOVEMENT_WORKER_REF,
    admissionKeyScope: "",
    constants: {
      stallRecoveryMs: MOVEMENT_STALL_RECOVERY_MS,
      maxAttempts: MOVEMENT_MAX_ATTEMPTS,
      retryBaseMs: MOVEMENT_RETRY_BASE_MS,
      retryMaxMs: MOVEMENT_RETRY_MAX_MS,
      waitingRetryMs: MOVEMENT_WAITING_RETRY_MS,
      backpressureRetryMs: MOVEMENT_BACKPRESSURE_RETRY_MS,
      retryJitterMs: MOVEMENT_RETRY_JITTER_MS,
      resetChildBatch: MOVEMENT_RESET_CHILD_BATCH,
      cleanupChildBatch: MOVEMENT_CLEANUP_CHILD_BATCH,
      admissionWindowMs: MOVEMENT_ADMISSION_WINDOW_MS,
      admissionsPerPrincipal: MOVEMENT_ADMISSIONS_PER_PRINCIPAL,
      admissionsPerStore: MOVEMENT_ADMISSIONS_PER_STORE,
      admissionsGlobal: MOVEMENT_ADMISSIONS_GLOBAL,
    },
    errorCodes: {
      workerFailed: MOVEMENT_ERROR_CODE_WORKER_FAILED,
      sourceStale: MOVEMENT_ERROR_CODE_SOURCE_STALE,
    },
    validateRange: (startDate, endDate) =>
      // Strict dates + the movement span ceiling (184 inclusive days —
      // the shared drill-down ceiling since U7).
      validateReportRangeRequest("sku_movement", startDate, endDate),
    computeRequestKey: (args) =>
      computeMovementRequestKey(
        {
          storeId: args.storeId,
          startDate: args.startDate,
          endDate: args.endDate,
          foldVersion: REPORTS_FOLD_VERSION,
          contractVersion: REPORT_MOVEMENT_CONTRACT_VERSION,
          revisionVector: args.revisionVector,
        },
        stableStringHash,
      ),
    deriveLifecycle: deriveMovementRequestLifecycle,
    children: {
      deleteStaleBatch: async (ctx, row, limit) => {
        const children = await ctx.db
          .query("reportRangeMovementSku")
          .withIndex("by_storeId_rangeResultId_productSkuId", (q) =>
            q.eq("storeId", row.storeId).eq("rangeResultId", row._id),
          )
          .take(limit);
        for (const child of children) {
          await ctx.db.delete("reportRangeMovementSku", child._id);
        }
        return children.length;
      },
      hasAny: async (ctx, row) => {
        const child = await ctx.db
          .query("reportRangeMovementSku")
          .withIndex("by_storeId_rangeResultId_productSkuId", (q) =>
            q.eq("storeId", row.storeId).eq("rangeResultId", row._id),
          )
          .first();
        return child !== null;
      },
      deleteExpiredBatch: async (ctx, now, limit) => {
        const expired = await ctx.db
          .query("reportRangeMovementSku")
          .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
          .take(limit);
        for (const child of expired) {
          await ctx.db.delete("reportRangeMovementSku", child._id);
        }
        return expired.length;
      },
    },
    aggregateSourceDay: aggregateMovementSourceDay,
    onEnterRanking: () => ({ movementTotals: ZERO_TOTALS }),
    runRankingBatch: runMovementRankingBatch,
  };

// ---------------------------------------------------------------------------
// Admission snapshot: the bounded revision-vector read that runs on EVERY
// ensure call (including waiting-state polls). Budget: ≤ 184 reportDay rows +
// one dirty-marker existence probe, both on store-prefixed indexes.
// ---------------------------------------------------------------------------

export type MovementAdmissionSnapshot = RangeSnapshotAdmissionSnapshot;

export async function readMovementRevisionVector(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  storeId: Id<"store">,
  startDate: string,
  endDate: string,
): Promise<MovementAdmissionSnapshot> {
  return readRangeRevisionVector(
    ctx,
    storeId,
    startDate,
    endDate,
    REPORT_MOVEMENT_RANGE_MAX_DAYS,
  );
}

/**
 * Check-then-consume across principal/store/global. Returns false (and writes
 * nothing) when any scope is saturated; otherwise consumes one unit from each.
 */
export async function tryConsumeMovementAdmission(
  ctx: Pick<MutationCtx, "db">,
  args: { principalKey: string; storeKey: string; now: number },
): Promise<boolean> {
  return tryConsumeRangeSnapshotAdmission(
    ctx,
    MOVEMENT_RANGE_SNAPSHOT_KIND,
    args,
  );
}

// ---------------------------------------------------------------------------
// Ensure — the idempotent public admission boundary. The gate ordering
// (allowlist → validate → revision vector → dedupe → admission → insert +
// schedule) is the generic lifecycle's; see ensureRangeSnapshotCore.
// ---------------------------------------------------------------------------

export type MovementEnsureResult = {
  /** Present only when a durable request row exists for this identity. */
  requestKey: string | null;
  lifecycle: ReportMovementLifecycle;
};

type EnsureCoreArgs = {
  storeId: Id<"store">;
  /** Stable per-caller admission key — the authenticated athenaUser id. */
  principalKey: string;
  startDate: string;
  endDate: string;
  now?: number;
};

/** The access-checked core (testable-core / thin-wrapper split, as in
 * customRange.requestRangeCore). */
export async function ensureMovementRangeCore(
  ctx: MutationCtx,
  args: EnsureCoreArgs,
): Promise<MovementEnsureResult> {
  return ensureRangeSnapshotCore(ctx, MOVEMENT_RANGE_SNAPSHOT_KIND, args);
}

export const ensureMovementRange = mutation({
  args: {
    storeId: v.id("store"),
    startDate: v.string(),
    endDate: v.string(),
  },
  // Generation authority: shared-demo actors are denied at admission
  // (`reporting.generate` is not a demo-allowed capability, so the definition
  // declares `sharedDemo: "deny"`), independent of any client demo gating;
  // then the full-admin reports gate runs.
  handler: admitPublicMutation(
    ensureMovementRangeOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: { storeId: Id<"store">; startDate: string; endDate: string },
    ): Promise<MovementEnsureResult> => {
      const { athenaUser } = await requireReportsStoreAccess(ctx, args.storeId);
      return ensureMovementRangeCore(ctx, {
        storeId: args.storeId,
        principalKey: String(athenaUser._id),
        startDate: args.startDate,
        endDate: args.endDate,
      });
    },
  ),
});

// ---------------------------------------------------------------------------
// Retry — a NEW fenced attempt for an unexpired terminal request, never the
// same failed row's state. See retryTerminalRangeSnapshot for the semantics.
// ---------------------------------------------------------------------------

export const retryMovementRange = mutation({
  args: { storeId: v.id("store"), requestKey: v.string() },
  handler: admitPublicMutation(
    retryMovementRangeOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: { storeId: Id<"store">; requestKey: string },
    ): Promise<MovementEnsureResult> => {
      const { athenaUser } = await requireReportsStoreAccess(ctx, args.storeId);
      return retryTerminalMovementRequest(ctx, {
        storeId: args.storeId,
        requestKey: args.requestKey,
        principalKey: String(athenaUser._id),
      });
    },
  ),
});

/**
 * The real retry core. If the current source revision vector still matches
 * the terminal row's identity, the SAME row is reset under a new fence
 * (phase back to queued, stale children cleared by the queued reset batch);
 * if the vector moved on, the terminal row is left for TTL cleanup and the
 * ordinary ensure path admits the successor identity.
 */
export async function retryTerminalMovementRequest(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    requestKey: string;
    principalKey: string;
    now?: number;
  },
): Promise<MovementEnsureResult> {
  return retryTerminalRangeSnapshot(ctx, MOVEMENT_RANGE_SNAPSHOT_KIND, args);
}

// ---------------------------------------------------------------------------
// The fenced batch state machine — generic; movement binds its config.
// ---------------------------------------------------------------------------

export type MovementBatchIntent = RangeSnapshotBatchIntent;

type BatchArgs = {
  rangeResultId: Id<"reportRangeResult">;
  expectedPhase: string;
  expectedFence: number;
  now?: number;
};

/**
 * One atomic unit of movement work. Unexpected defects are deliberately NOT
 * caught here: Convex rolls the whole batch back (aggregates, cursor, fence
 * together) and the worker action records retry metadata in a SEPARATE
 * mutation. Everything returned is scheduling intent only.
 */
export async function runMovementBatchCore(
  ctx: MutationCtx,
  args: BatchArgs,
): Promise<MovementBatchIntent> {
  return runRangeSnapshotBatchCore(ctx, MOVEMENT_RANGE_SNAPSHOT_KIND, args);
}

export const runMovementBatch = internalMutation({
  args: {
    rangeResultId: v.id("reportRangeResult"),
    expectedPhase: v.string(),
    expectedFence: v.number(),
  },
  handler: runMovementBatchCore,
});

// ---------------------------------------------------------------------------
// Failure lane — the SEPARATE transaction that records retry/backoff or the
// sanitized terminal state after Convex rolled the failed batch back.
// ---------------------------------------------------------------------------

export function movementRetryBackoffMs(attempt: number): number {
  return rangeSnapshotRetryBackoffMs(
    {
      retryBaseMs: MOVEMENT_RETRY_BASE_MS,
      retryMaxMs: MOVEMENT_RETRY_MAX_MS,
    },
    attempt,
  );
}

export async function recordMovementWorkerFailureCore(
  ctx: MutationCtx,
  args: {
    rangeResultId: Id<"reportRangeResult">;
    expectedFence: number;
    now?: number;
  },
): Promise<{ recorded: boolean; correlationId?: string }> {
  return recordRangeSnapshotWorkerFailureCore(
    ctx,
    MOVEMENT_RANGE_SNAPSHOT_KIND,
    args,
  );
}

export const recordMovementWorkerFailure = internalMutation({
  args: {
    rangeResultId: v.id("reportRangeResult"),
    expectedFence: v.number(),
  },
  handler: recordMovementWorkerFailureCore,
});

// ---------------------------------------------------------------------------
// The continuation wrapper — the module's only action. It never touches the
// database itself: one atomic batch mutation per invocation, escape-and-
// rollback failure handling, and prompt self-scheduling on "continue".
// ---------------------------------------------------------------------------

export const runMovementWorker = internalAction({
  args: {
    rangeResultId: v.id("reportRangeResult"),
    expectedPhase: v.string(),
    expectedFence: v.number(),
  },
  handler: async (ctx, args): Promise<null> => {
    try {
      const intent = await ctx.runMutation(MOVEMENT_BATCH_REF, args);
      if (intent.next === "continue") {
        await ctx.scheduler.runAfter(0, MOVEMENT_WORKER_REF, {
          rangeResultId: args.rangeResultId,
          expectedPhase: intent.phase,
          expectedFence: intent.fence,
        });
      }
    } catch (error) {
      // The batch rolled back in full. Record retry metadata in a separate
      // transaction; the exception text stays in backend logs, keyed by the
      // opaque correlation id when the failure went terminal.
      const outcome = await ctx.runMutation(MOVEMENT_FAILURE_REF, {
        rangeResultId: args.rangeResultId,
        expectedFence: args.expectedFence,
      });
      console.error(
        `[reports.skuMovementRange] worker batch failed` +
          ` (request=${args.rangeResultId}` +
          `${outcome.correlationId ? ` correlation=${outcome.correlationId}` : ""})`,
        error,
      );
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Public readers. Both live behind the ordinary Reports read boundary (the
// same full-admin/shared-demo `reports.read` gate every reports query uses),
// resolve headers only through the store-prefixed request-key index, and
// return bounded payloads.
// ---------------------------------------------------------------------------

export type MovementRangeStatus = {
  requestKey: string;
  startDate: string;
  endDate: string;
  lifecycle: ReportMovementLifecycle;
} | null;

function readableMovementHeader(
  row: Doc<"reportRangeResult"> | null,
  now: number,
): Doc<"reportRangeResult"> | null {
  return readableRangeSnapshotHeader(MOVEMENT_RANGE_SNAPSHOT_KIND, row, now);
}

/**
 * Lightweight lifecycle subscription for an admitted request — no rows, so
 * an open sheet can track queued/completed/terminal cheaply and switch to
 * the page reader once completed. Read budget: 1 header doc.
 */
export const getMovementRange = query({
  args: { storeId: v.id("store"), requestKey: v.string() },
  handler: admitPublicQuery(
    getMovementRangeReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { storeId: Id<"store">; requestKey: string },
    ): Promise<MovementRangeStatus> => {
    await requireReportsStoreAccess(ctx, args.storeId);
    const row = readableMovementHeader(
      await ctx.db
        .query("reportRangeResult")
        .withIndex("by_storeId_requestKey", (q) =>
          q.eq("storeId", args.storeId).eq("requestKey", args.requestKey),
        )
        .unique(),
      Date.now(),
    );
    if (!row) return null;
    return {
      requestKey: row.requestKey,
      startDate: row.startDate,
      endDate: row.endDate,
      lifecycle: deriveMovementRequestLifecycle(row),
    };
    },
  ),
});

export type ReportMovementPageRow = ReportSkuMovementRow & { rank: number };

export type MovementRangePage = {
  requestKey: string;
  startDate: string;
  endDate: string;
  lifecycle: ReportMovementLifecycle;
  /** Canonical page actually served (1-based; clamped to pageCount). */
  page: number;
  /** 0 until the snapshot completes. */
  pageCount: number;
  rows: ReportMovementPageRow[];
} | null;

function requireValidMovementPage(page: number): void {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error("Movement page must be a positive integer.");
  }
}

/**
 * One 20-row ranked page. Read budget: 1 header doc + ≤20 child rows through
 * the exact rank interval + ≤40 identity docs (2 per visible row).
 */
export const getMovementRangePage = query({
  args: {
    storeId: v.id("store"),
    requestKey: v.string(),
    page: v.number(),
  },
  handler: admitPublicQuery(
    getMovementRangePageReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { storeId: Id<"store">; requestKey: string; page: number },
    ): Promise<MovementRangePage> => {
    requireValidMovementPage(args.page);
    await requireReportsStoreAccess(ctx, args.storeId);

    const row = readableMovementHeader(
      await ctx.db
        .query("reportRangeResult")
        .withIndex("by_storeId_requestKey", (q) =>
          q.eq("storeId", args.storeId).eq("requestKey", args.requestKey),
        )
        .unique(),
      Date.now(),
    );
    if (!row) return null;

    const lifecycle = deriveMovementRequestLifecycle(row);
    if (lifecycle.state !== "completed") {
      return {
        requestKey: row.requestKey,
        startDate: row.startDate,
        endDate: row.endDate,
        lifecycle,
        page: 1,
        pageCount: 0,
        rows: [],
      };
    }

    // Canonicalize against the authoritative completed count.
    const pageCount = movementPageCount(lifecycle.totals.skuCount);
    const page = Math.min(args.page, pageCount);
    const firstRank = (page - 1) * REPORT_MOVEMENT_PAGE_SIZE + 1;
    const lastRank = page * REPORT_MOVEMENT_PAGE_SIZE;

    const children = await ctx.db
      .query("reportRangeMovementSku")
      .withIndex("by_storeId_rangeResultId_rank", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("rangeResultId", row._id)
          .gte("rank", firstRank)
          .lte("rank", lastRank),
      )
      .take(REPORT_MOVEMENT_PAGE_SIZE);

    const rows: ReportMovementPageRow[] = await Promise.all(
      children.map(async (child) => {
        const identity = await resolveSkuIdentity(ctx, child.productSkuId);
        return {
          key: String(child.productSkuId),
          productSkuId: String(child.productSkuId),
          label:
            identity?.sku ??
            identity?.displayName ??
            String(child.productSkuId),
          unitsSold: child.unitsSold,
          unitsReturned: child.unitsReturned,
          netUnits: child.netUnits,
          rank: child.rank!,
          ...(identity ? { identity } : {}),
        };
      }),
    );

    return {
      requestKey: row.requestKey,
      startDate: row.startDate,
      endDate: row.endDate,
      lifecycle,
      page,
      pageCount,
      rows,
    };
    },
  ),
});
