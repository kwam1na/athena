import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  REPORTS_FOLD_VERSION,
  REPORT_MIX_CONTRACT_VERSION,
  REPORT_MIX_RANGE_MAX_DAYS,
  REPORT_MIX_VISIBLE_ROW_LIMIT,
  computeMixRequestKey,
  deriveMixRequestLifecycle,
  mixUnitsSoldSortKey,
  movementSourceRowMatchesRevision,
  validateReportRangeRequest,
  type ReportMixLifecycle,
  type ReportMovementDayRevision,
  type ReportMovementTotals,
  type ReportSkuMixData,
} from "../../shared/reportsContract";
import { requireReportsStoreAccess } from "./access";
import {
  ensureMixRangeOperationDefinition,
  retryMixRangeOperationDefinition,
} from "../operationAdmission/domains/reports_definitions";
import {
  getMixRangeReadDefinition,
  getMixRangeVisibleReadDefinition,
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
  recordRangeSnapshotWorkerFailureCore,
  rangeSnapshotRetryBackoffMs,
  retryTerminalRangeSnapshot,
  runRangeSnapshotBatchCore,
  type RangeSnapshotBatchIntent,
  type RangeSnapshotKindConfig,
} from "./rangeSnapshotLifecycle";

/**
 * The SKU-mix range lifecycle — the second kinded consumer of the generic
 * bounded-resumable-range-snapshot machinery in
 * `reports/rangeSnapshotLifecycle.ts` (U3), and the first WITHOUT a ranking
 * phase.
 *
 * Mix only ever presents top 5 + Other: there are no pages, so nothing needs
 * an ordinal rank. Aggregation accumulates `unitsSold` per SKU into
 * `reportRangeMixSku` children (descending units-sold sort key, no rank
 * field) one certified operating day at a time, accumulates the header
 * totals during aggregation (there is no ranking pass to accumulate in), and
 * the last aggregation batch publishes directly — aggregating → completed —
 * after the generic clean-vector recheck. The reader then takes the top 5
 * children through the sort-key index, hydrates at most those 5 identities,
 * and derives the Other bucket arithmetically from the header totals; the
 * complete result never crosses to the browser.
 *
 * The synchronous `listRangeSkuMix` (reports/queries.ts) is untouched — it
 * remains the permanent ≤2-day path (U5 routes by span), and this lifecycle
 * must present the identical contract for the ranges it serves.
 */

// ---------------------------------------------------------------------------
// Named constants. Every batch, admission, backoff, and cleanup bound the mix
// lifecycle uses lives here, beside the config that consumes it.
// ---------------------------------------------------------------------------

/** Per-day source rows one aggregation batch may read. Mirrors the fold's
 * MAX_SKU_DAY_ROWS_PER_DAY cap — a certified day can never exceed it. */
export const MIX_SOURCE_DAY_ROW_CAP = 2000;
/** Stale children deleted per reset ("queued") batch before re-aggregation. */
export const MIX_RESET_CHILD_BATCH = 500;

/** Worker failures tolerated before the request goes terminal. */
export const MIX_MAX_ATTEMPTS = 5;
/** Retry backoff: base doubling per attempt, capped. */
export const MIX_RETRY_BASE_MS = 30_000;
export const MIX_RETRY_MAX_MS = 10 * 60_000;
/** An active row untouched for this long is considered a dropped
 * continuation; the sweeper backstop reschedules it. */
export const MIX_STALL_RECOVERY_MS = 10 * 60_000;

/** Server-chosen ensure polling intervals (plus jitter, so many open views
 * cannot align into a retry storm). */
export const MIX_WAITING_RETRY_MS = 15_000;
export const MIX_BACKPRESSURE_RETRY_MS = 10_000;
export const MIX_RETRY_JITTER_MS = 5_000;

/**
 * Fixed admission window and its per-scope budgets (new admissions only —
 * reusing an existing request never consumes budget).
 *
 * Sized for AMBIENT usage, deliberately higher than movement's on-demand
 * budgets (4/8/20): a movement snapshot exists only when someone opens the
 * Units-moved sheet, but every multi-day Reports view ensures a mix snapshot
 * as part of simply rendering — so ordinary period browsing (a user stepping
 * through several presets, several staff on one store) creates several
 * distinct request identities in quick succession without any of it being
 * abusive. Dedupe still absorbs most of that (same store + range + revisions
 * reuse one request), so the budgets only bound NEW identities per 10-minute
 * window: 24 per principal (a user flipping through many periods), 48 per
 * store (a few concurrent users), 120 globally. U5's span routing keeps
 * day-click traffic off this path entirely (≤2-day spans stay synchronous).
 */
export const MIX_ADMISSION_WINDOW_MS = 10 * 60_000;
export const MIX_ADMISSIONS_PER_PRINCIPAL = 24;
export const MIX_ADMISSIONS_PER_STORE = 48;
export const MIX_ADMISSIONS_GLOBAL = 120;

/** Expired child rows deleted per sweep tick (child-first cleanup). */
export const MIX_CLEANUP_CHILD_BATCH = 2500;

/**
 * Steady-state sizing inputs for the cleanup budget. The sweeper runs every
 * five minutes (convex/crons.ts); mix's ambient admission profile admits more
 * requests per day than movement's on-demand one, and a long range can touch
 * the fold's full 2,000-row/day child ceiling worth of distinct SKUs, so the
 * per-tick child batch is larger (2,500 vs movement's 1,500). Per-day cleanup
 * capacity must exceed per-day child creation — asserted in
 * skuMixRange.test.ts.
 */
export const MIX_STEADY_STATE_REQUESTS_PER_DAY = 300;
export const MIX_STEADY_STATE_CHILDREN_PER_REQUEST = 2000;
export { REPORTS_SWEEP_INTERVAL_MS } from "./skuMovementRange";

/** Sanitized terminal codes — the only error identities a client ever sees. */
export const MIX_ERROR_CODE_WORKER_FAILED = "mix_worker_failed";
export const MIX_ERROR_CODE_SOURCE_STALE = "mix_source_stale";

// ---------------------------------------------------------------------------
// Function references for the continuation chain. Built by path rather than
// read off `internal.reports.skuMixRange` because _generated/api.d.ts is
// regenerated at deploy time and predates this module (same staleness the
// movement module documents at its refs). The path string is what the
// runtime uses either way.
// ---------------------------------------------------------------------------

const MIX_WORKER_REF = makeFunctionReference<
  "action",
  {
    rangeResultId: Id<"reportRangeResult">;
    expectedPhase: string;
    expectedFence: number;
  }
>("reports/skuMixRange:runMixWorker");

const MIX_BATCH_REF = makeFunctionReference<
  "mutation",
  {
    rangeResultId: Id<"reportRangeResult">;
    expectedPhase: string;
    expectedFence: number;
  },
  MixBatchIntent
>("reports/skuMixRange:runMixBatch");

const MIX_FAILURE_REF = makeFunctionReference<
  "mutation",
  { rangeResultId: Id<"reportRangeResult">; expectedFence: number },
  { recorded: boolean; correlationId?: string }
>("reports/skuMixRange:recordMixWorkerFailure");

// ---------------------------------------------------------------------------
// Mix's kind-specific seams: the source projection into the
// `reportRangeMixSku` child table (with header-side totals accumulation) and
// child bookkeeping. Everything else — gate ordering, fencing, retry,
// scheduling, backstop, cleanup — is the generic lifecycle acting on the
// config below.
// ---------------------------------------------------------------------------

/**
 * Mix totals on the generic header rail: `unitsSold` and `netUnits` both
 * carry the sold total (mix records sold units only, so net-of-returns
 * equals sold), `unitsReturned` is structurally zero, and `skuCount` counts
 * distinct SKUs with any units sold. The public projection
 * (`deriveMixRequestLifecycle`) exposes `{totalUnitsSold, skuCount}`.
 */
const MIX_ZERO_RAIL_TOTALS: ReportMovementTotals = {
  unitsSold: 0,
  unitsReturned: 0,
  netUnits: 0,
  skuCount: 0,
};

/**
 * Aggregate one admitted operating day: bounded reportSkuDay read, per-row
 * revision match, child upserts, and the header totals accumulation. The
 * generic machinery has already verified the day is neither dirty nor on a
 * different certified revision.
 *
 * Zero-sold source rows are skipped entirely (a day with only returns
 * contributes nothing to mix). `reportSkuDay.unitsSold` is never negative,
 * so a child row exists exactly when the SKU's aggregate is > 0 — matching
 * the sync reader's aggregate-level `unitsSold > 0` filter: a SKU that sold
 * on one day counts even when another included day recorded zero.
 *
 * Totals accumulate on the header HERE because mix has no ranking pass. The
 * running accumulator is safe across failures and retries: a failed batch
 * rolls back the totals patch together with the child writes and cursor, and
 * the generic retry/source-stale paths erase `movementTotals` whenever
 * children are reset.
 */
async function aggregateMixSourceDay(
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
    .take(MIX_SOURCE_DAY_ROW_CAP + 1);
  if (sourceRows.length > MIX_SOURCE_DAY_ROW_CAP) {
    // A certified day cannot exceed the fold cap; this is a defect, and the
    // action's failure lane owns it.
    throw new Error(`mix source day ${operatingDate} exceeds the row cap`);
  }

  const totals = { ...(row.movementTotals ?? MIX_ZERO_RAIL_TOTALS) };
  let touched = false;
  for (const source of sourceRows) {
    if (!movementSourceRowMatchesRevision(expected.revision, source)) {
      return "source_stale";
    }
    if (source.unitsSold === 0) continue;
    const child = await ctx.db
      .query("reportRangeMixSku")
      .withIndex("by_storeId_rangeResultId_productSkuId", (q) =>
        q
          .eq("storeId", row.storeId)
          .eq("rangeResultId", row._id)
          .eq("productSkuId", source.productSkuId),
      )
      .unique();
    const unitsSold = (child?.unitsSold ?? 0) + source.unitsSold;
    if (child) {
      await ctx.db.patch("reportRangeMixSku", child._id, {
        unitsSold,
        unitsSoldSortKey: mixUnitsSoldSortKey(unitsSold),
      });
    } else {
      await ctx.db.insert("reportRangeMixSku", {
        storeId: row.storeId,
        rangeResultId: row._id,
        productSkuId: source.productSkuId,
        unitsSold,
        unitsSoldSortKey: mixUnitsSoldSortKey(unitsSold),
        expiresAt: row.expiresAt,
      });
      totals.skuCount += 1;
    }
    totals.unitsSold += source.unitsSold;
    totals.netUnits += source.unitsSold;
    touched = true;
  }

  if (touched) {
    await ctx.db.patch("reportRangeResult", row._id, {
      movementTotals: totals,
    });
  }
  return "ok";
}

/**
 * Mix's per-kind lifecycle configuration. `hasRankingPhase: false` — the
 * generic machinery runs the publication recheck in the last aggregation
 * batch and transitions aggregating → completed directly; `completionPatch`
 * only backfills zero totals for a range whose every day was empty (no
 * aggregation batch ever wrote the accumulator).
 */
export const MIX_RANGE_SNAPSHOT_KIND: RangeSnapshotKindConfig<ReportMixLifecycle> =
  {
    kind: "sku_mix",
    contractVersion: REPORT_MIX_CONTRACT_VERSION,
    maxRangeDays: REPORT_MIX_RANGE_MAX_DAYS,
    hasRankingPhase: false,
    workerRef: MIX_WORKER_REF,
    // Kind-scoped admission buckets ("sku_mix:<raw key>") keep mix's ambient
    // budgets fully independent of movement's grandfathered raw-key buckets.
    admissionKeyScope: "sku_mix",
    constants: {
      stallRecoveryMs: MIX_STALL_RECOVERY_MS,
      maxAttempts: MIX_MAX_ATTEMPTS,
      retryBaseMs: MIX_RETRY_BASE_MS,
      retryMaxMs: MIX_RETRY_MAX_MS,
      waitingRetryMs: MIX_WAITING_RETRY_MS,
      backpressureRetryMs: MIX_BACKPRESSURE_RETRY_MS,
      retryJitterMs: MIX_RETRY_JITTER_MS,
      resetChildBatch: MIX_RESET_CHILD_BATCH,
      cleanupChildBatch: MIX_CLEANUP_CHILD_BATCH,
      admissionWindowMs: MIX_ADMISSION_WINDOW_MS,
      admissionsPerPrincipal: MIX_ADMISSIONS_PER_PRINCIPAL,
      admissionsPerStore: MIX_ADMISSIONS_PER_STORE,
      admissionsGlobal: MIX_ADMISSIONS_GLOBAL,
    },
    errorCodes: {
      workerFailed: MIX_ERROR_CODE_WORKER_FAILED,
      sourceStale: MIX_ERROR_CODE_SOURCE_STALE,
    },
    validateRange: (startDate, endDate) =>
      // Strict dates + the mix span ceiling (184 inclusive days).
      validateReportRangeRequest("sku_mix", startDate, endDate),
    computeRequestKey: (args) =>
      computeMixRequestKey(
        {
          storeId: args.storeId,
          startDate: args.startDate,
          endDate: args.endDate,
          foldVersion: REPORTS_FOLD_VERSION,
          contractVersion: REPORT_MIX_CONTRACT_VERSION,
          revisionVector: args.revisionVector,
        },
        stableStringHash,
      ),
    deriveLifecycle: deriveMixRequestLifecycle,
    children: {
      deleteStaleBatch: async (ctx, row, limit) => {
        const children = await ctx.db
          .query("reportRangeMixSku")
          .withIndex("by_storeId_rangeResultId_productSkuId", (q) =>
            q.eq("storeId", row.storeId).eq("rangeResultId", row._id),
          )
          .take(limit);
        for (const child of children) {
          await ctx.db.delete("reportRangeMixSku", child._id);
        }
        return children.length;
      },
      hasAny: async (ctx, row) => {
        const child = await ctx.db
          .query("reportRangeMixSku")
          .withIndex("by_storeId_rangeResultId_productSkuId", (q) =>
            q.eq("storeId", row.storeId).eq("rangeResultId", row._id),
          )
          .first();
        return child !== null;
      },
      deleteExpiredBatch: async (ctx, now, limit) => {
        const expired = await ctx.db
          .query("reportRangeMixSku")
          .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
          .take(limit);
        for (const child of expired) {
          await ctx.db.delete("reportRangeMixSku", child._id);
        }
        return expired.length;
      },
    },
    aggregateSourceDay: aggregateMixSourceDay,
    completionPatch: (row) => ({
      movementTotals: row.movementTotals ?? MIX_ZERO_RAIL_TOTALS,
    }),
  };

// ---------------------------------------------------------------------------
// Ensure — the idempotent public admission boundary. The gate ordering
// (allowlist → validate → revision vector → dedupe → admission → insert +
// schedule) is the generic lifecycle's; see ensureRangeSnapshotCore.
// ---------------------------------------------------------------------------

export type MixEnsureResult = {
  /** Present only when a durable request row exists for this identity. */
  requestKey: string | null;
  lifecycle: ReportMixLifecycle;
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
 * skuMovementRange.ensureMovementRangeCore). */
export async function ensureMixRangeCore(
  ctx: MutationCtx,
  args: EnsureCoreArgs,
): Promise<MixEnsureResult> {
  return ensureRangeSnapshotCore(ctx, MIX_RANGE_SNAPSHOT_KIND, args);
}

export const ensureMixRange = mutation({
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
    ensureMixRangeOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: { storeId: Id<"store">; startDate: string; endDate: string },
    ): Promise<MixEnsureResult> => {
      const { athenaUser } = await requireReportsStoreAccess(ctx, args.storeId);
      return ensureMixRangeCore(ctx, {
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

export const retryMixRange = mutation({
  args: { storeId: v.id("store"), requestKey: v.string() },
  handler: admitPublicMutation(
    retryMixRangeOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: { storeId: Id<"store">; requestKey: string },
    ): Promise<MixEnsureResult> => {
      const { athenaUser } = await requireReportsStoreAccess(ctx, args.storeId);
      return retryTerminalMixRequest(ctx, {
        storeId: args.storeId,
        requestKey: args.requestKey,
        principalKey: String(athenaUser._id),
      });
    },
  ),
});

export async function retryTerminalMixRequest(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    requestKey: string;
    principalKey: string;
    now?: number;
  },
): Promise<MixEnsureResult> {
  return retryTerminalRangeSnapshot(ctx, MIX_RANGE_SNAPSHOT_KIND, args);
}

// ---------------------------------------------------------------------------
// The fenced batch state machine — generic; mix binds its config.
// ---------------------------------------------------------------------------

export type MixBatchIntent = RangeSnapshotBatchIntent;

type BatchArgs = {
  rangeResultId: Id<"reportRangeResult">;
  expectedPhase: string;
  expectedFence: number;
  now?: number;
};

/**
 * One atomic unit of mix work. Unexpected defects are deliberately NOT
 * caught here: Convex rolls the whole batch back (child writes, totals,
 * cursor, fence together) and the worker action records retry metadata in a
 * SEPARATE mutation. Everything returned is scheduling intent only.
 */
export async function runMixBatchCore(
  ctx: MutationCtx,
  args: BatchArgs,
): Promise<MixBatchIntent> {
  return runRangeSnapshotBatchCore(ctx, MIX_RANGE_SNAPSHOT_KIND, args);
}

export const runMixBatch = internalMutation({
  args: {
    rangeResultId: v.id("reportRangeResult"),
    expectedPhase: v.string(),
    expectedFence: v.number(),
  },
  handler: runMixBatchCore,
});

// ---------------------------------------------------------------------------
// Failure lane — the SEPARATE transaction that records retry/backoff or the
// sanitized terminal state after Convex rolled the failed batch back.
// ---------------------------------------------------------------------------

export function mixRetryBackoffMs(attempt: number): number {
  return rangeSnapshotRetryBackoffMs(
    { retryBaseMs: MIX_RETRY_BASE_MS, retryMaxMs: MIX_RETRY_MAX_MS },
    attempt,
  );
}

export async function recordMixWorkerFailureCore(
  ctx: MutationCtx,
  args: {
    rangeResultId: Id<"reportRangeResult">;
    expectedFence: number;
    now?: number;
  },
): Promise<{ recorded: boolean; correlationId?: string }> {
  return recordRangeSnapshotWorkerFailureCore(
    ctx,
    MIX_RANGE_SNAPSHOT_KIND,
    args,
  );
}

export const recordMixWorkerFailure = internalMutation({
  args: {
    rangeResultId: v.id("reportRangeResult"),
    expectedFence: v.number(),
  },
  handler: recordMixWorkerFailureCore,
});

// ---------------------------------------------------------------------------
// The continuation wrapper — the module's only action. It never touches the
// database itself: one atomic batch mutation per invocation, escape-and-
// rollback failure handling, and prompt self-scheduling on "continue".
// ---------------------------------------------------------------------------

export const runMixWorker = internalAction({
  args: {
    rangeResultId: v.id("reportRangeResult"),
    expectedPhase: v.string(),
    expectedFence: v.number(),
  },
  handler: async (ctx, args): Promise<null> => {
    try {
      const intent = await ctx.runMutation(MIX_BATCH_REF, args);
      if (intent.next === "continue") {
        await ctx.scheduler.runAfter(0, MIX_WORKER_REF, {
          rangeResultId: args.rangeResultId,
          expectedPhase: intent.phase,
          expectedFence: intent.fence,
        });
      }
    } catch (error) {
      // The batch rolled back in full. Record retry metadata in a separate
      // transaction; the exception text stays in backend logs, keyed by the
      // opaque correlation id when the failure went terminal.
      const outcome = await ctx.runMutation(MIX_FAILURE_REF, {
        rangeResultId: args.rangeResultId,
        expectedFence: args.expectedFence,
      });
      console.error(
        `[reports.skuMixRange] worker batch failed` +
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

export type MixRangeStatus = {
  requestKey: string;
  startDate: string;
  endDate: string;
  lifecycle: ReportMixLifecycle;
} | null;

function readableMixHeader(
  row: Doc<"reportRangeResult"> | null,
  now: number,
): Doc<"reportRangeResult"> | null {
  return readableRangeSnapshotHeader(MIX_RANGE_SNAPSHOT_KIND, row, now);
}

/**
 * Lightweight lifecycle subscription for an admitted request — no rows, so
 * an open view can track queued/completed/terminal cheaply and switch to the
 * visible reader once completed. Read budget: 1 header doc.
 */
export const getMixRange = query({
  args: { storeId: v.id("store"), requestKey: v.string() },
  handler: admitPublicQuery(
    getMixRangeReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { storeId: Id<"store">; requestKey: string },
    ): Promise<MixRangeStatus> => {
    await requireReportsStoreAccess(ctx, args.storeId);
    const row = readableMixHeader(
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
      lifecycle: deriveMixRequestLifecycle(row),
    };
    },
  ),
});

export type MixRangeVisible = {
  requestKey: string;
  startDate: string;
  endDate: string;
  lifecycle: ReportMixLifecycle;
  /** Present only once the lifecycle is completed; null while pending or
   * terminal. Exactly `listRangeSkuMix`'s shape for the same activity. */
  data: ReportSkuMixData | null;
} | null;

/**
 * The visible-rows reader: top 5 + Other, `listRangeSkuMix`-compatible.
 *
 * Read budget after completion: 1 header doc + 5 child rows through the
 * exact sort-key index prefix + ≤10 identity docs (2 per visible row).
 * Identities are hydrated only after `requireReportsStoreAccess` verified
 * store ownership and only for the ≤5 visible rows; the Other bucket is
 * derived arithmetically from the authoritative header totals, so the
 * complete per-SKU result never crosses to the browser. Other carries NO
 * productSkuId or identity (detail links exist on identified rows only).
 */
export const getMixRangeVisible = query({
  args: { storeId: v.id("store"), requestKey: v.string() },
  handler: admitPublicQuery(
    getMixRangeVisibleReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { storeId: Id<"store">; requestKey: string },
    ): Promise<MixRangeVisible> => {
    await requireReportsStoreAccess(ctx, args.storeId);

    const row = readableMixHeader(
      await ctx.db
        .query("reportRangeResult")
        .withIndex("by_storeId_requestKey", (q) =>
          q.eq("storeId", args.storeId).eq("requestKey", args.requestKey),
        )
        .unique(),
      Date.now(),
    );
    if (!row) return null;

    const lifecycle = deriveMixRequestLifecycle(row);
    if (lifecycle.state !== "completed") {
      return {
        requestKey: row.requestKey,
        startDate: row.startDate,
        endDate: row.endDate,
        lifecycle,
        data: null,
      };
    }

    const { totalUnitsSold, skuCount } = lifecycle.totals;

    // Top 5 by descending units sold (negated key, ascending index) with
    // stable SKU identity as the tie-break — deterministic without any rank.
    const leading = await ctx.db
      .query("reportRangeMixSku")
      .withIndex(
        "by_storeId_rangeResultId_unitsSoldSortKey_productSkuId",
        (q) => q.eq("storeId", args.storeId).eq("rangeResultId", row._id),
      )
      .take(REPORT_MIX_VISIBLE_ROW_LIMIT);

    const shareOf = (unitsSold: number): number =>
      totalUnitsSold === 0
        ? 0
        : Math.round((unitsSold / totalUnitsSold) * 10_000);

    const rows: ReportSkuMixData["rows"] = await Promise.all(
      leading.map(async (child) => {
        const identity = await resolveSkuIdentity(ctx, child.productSkuId);
        return {
          key: String(child.productSkuId),
          productSkuId: String(child.productSkuId),
          label:
            identity?.sku ??
            identity?.displayName ??
            String(child.productSkuId),
          unitsSold: child.unitsSold,
          shareBasisPoints: shareOf(child.unitsSold),
          ...(identity ? { identity } : {}),
        };
      }),
    );

    const visibleUnitsSold = leading.reduce(
      (total, child) => total + child.unitsSold,
      0,
    );
    const otherUnitsSold = totalUnitsSold - visibleUnitsSold;
    if (otherUnitsSold > 0) {
      rows.push({
        key: "other",
        label: "Other SKUs",
        unitsSold: otherUnitsSold,
        shareBasisPoints: shareOf(otherUnitsSold),
      });
    }

    return {
      requestKey: row.requestKey,
      startDate: row.startDate,
      endDate: row.endDate,
      lifecycle,
      data: { rows, totalUnitsSold, skuCount },
    };
    },
  ),
});
