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
  REPORT_MOVEMENT_EMPTY_DAY_REVISION,
  REPORT_MOVEMENT_PAGE_SIZE,
  REPORT_MOVEMENT_RANGE_MAX_DAYS,
  REPORT_RANGE_TTL_MS,
  admissibleMovementDayRevision,
  computeMovementRequestKey,
  deriveMovementRequestLifecycle,
  movementAbsNetUnitsSortKey,
  movementPageCount,
  movementSourceRowMatchesRevision,
  validateReportRangeRequest,
  type ReportMovementDayRevision,
  type ReportMovementLifecycle,
  type ReportMovementRequestPhase,
  type ReportMovementTotals,
  type ReportSkuMovementRow,
} from "../../shared/reportsContract";
import { requireReportsStoreAccess } from "./access";
import { requireSharedDemoCapabilityIfApplicable } from "../sharedDemo/actor";
import { stableStringHash } from "./fingerprint";
import { readStoreAllowlist } from "./sweeper";
import { addDaysToDate } from "./rollups";
import { resolveSkuIdentity } from "./queries";

/**
 * The SKU-movement range lifecycle — the second consumer of the shared
 * `reportRangeResult` header, and the reports module's first durable worker.
 *
 * One admitted request is one immutable snapshot: its identity (the
 * "movement:" request key) folds in store, range, fold/contract versions, and
 * the certified revision of every included operating day. A private worker
 * action drives resumable, fenced batches — reset → aggregate one operating
 * day at a time → rank in bounded index intervals → recheck the revision
 * vector → publish — and the sweeper's unconditional backstop rescues any
 * dropped continuation through the global `by_movementEligibleAt` index.
 *
 * Division of responsibility with the sweeper (see sweeper.ts's header):
 * declarative dirty marks own FOLDS; this module owns its own eligible-work
 * queue plus a cron backstop that only SCHEDULES — the broad sweep mutation
 * never aggregates movement rows inline.
 */

// ---------------------------------------------------------------------------
// Named constants. Every batch, admission, backoff, and cleanup bound the
// lifecycle uses lives here, beside the code that consumes it.
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

/** Eligible workers the sweeper backstop schedules per tick. */
export const MOVEMENT_BACKSTOP_SCHEDULES_PER_TICK = 5;
/** Expired child rows deleted per sweep tick (child-first cleanup). */
export const MOVEMENT_CLEANUP_CHILD_BATCH = 1500;
/** Expired movement headers examined per sweep tick. */
export const MOVEMENT_CLEANUP_HEADER_BATCH = 10;

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

const ACTIVE_MOVEMENT_PHASES: readonly ReportMovementRequestPhase[] = [
  "queued",
  "aggregating",
  "ranking",
  "retry_wait",
];

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
// Admission snapshot: the bounded revision-vector read that runs on EVERY
// ensure call (including waiting-state polls). Budget: ≤ 92 reportDay rows +
// one dirty-marker existence probe, both on store-prefixed indexes.
// ---------------------------------------------------------------------------

export type MovementAdmissionSnapshot =
  | { ready: false }
  | { ready: true; revisionVector: ReportMovementDayRevision[] };

export async function readMovementRevisionVector(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  storeId: Id<"store">,
  startDate: string,
  endDate: string,
): Promise<MovementAdmissionSnapshot> {
  const dirty = await ctx.db
    .query("reportDirtyDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q
        .eq("storeId", storeId)
        .gte("operatingDate", startDate)
        .lte("operatingDate", endDate),
    )
    .first();
  if (dirty) return { ready: false };

  const days = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q
        .eq("storeId", storeId)
        .gte("operatingDate", startDate)
        .lte("operatingDate", endDate),
    )
    .take(REPORT_MOVEMENT_RANGE_MAX_DAYS);

  const dayByDate = new Map(days.map((day) => [day.operatingDate, day]));
  const revisionVector: ReportMovementDayRevision[] = [];
  for (
    let date = startDate;
    date <= endDate;
    date = addDaysToDate(date, 1)
  ) {
    const entry = admissibleMovementDayRevision(
      date,
      dayByDate.get(date) ?? null,
    );
    if (entry === null) return { ready: false };
    revisionVector.push(entry);
  }
  return { ready: true, revisionVector };
}

function sameRevisionVector(
  a: readonly ReportMovementDayRevision[],
  b: readonly ReportMovementDayRevision[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (entry, index) =>
      entry.operatingDate === b[index]!.operatingDate &&
      entry.revision === b[index]!.revision,
  );
}

// ---------------------------------------------------------------------------
// Admission windows: fixed-window counters, checked across all three scopes
// BEFORE any write. Saturation returns retryable backpressure with zero
// writes; only a successful new admission consumes budget.
// ---------------------------------------------------------------------------

type AdmissionScope = Doc<"reportMovementAdmission">["scope"];

const ADMISSION_LIMITS: Record<AdmissionScope, number> = {
  principal: MOVEMENT_ADMISSIONS_PER_PRINCIPAL,
  store: MOVEMENT_ADMISSIONS_PER_STORE,
  global: MOVEMENT_ADMISSIONS_GLOBAL,
};

async function readAdmissionBucket(
  ctx: Pick<MutationCtx, "db">,
  scope: AdmissionScope,
  key: string,
) {
  return await ctx.db
    .query("reportMovementAdmission")
    .withIndex("by_scope_key", (q) => q.eq("scope", scope).eq("key", key))
    .unique();
}

function bucketSaturated(
  bucket: Doc<"reportMovementAdmission"> | null,
  limit: number,
  now: number,
): boolean {
  if (!bucket) return false;
  if (bucket.windowStartedAt <= now - MOVEMENT_ADMISSION_WINDOW_MS) {
    return false;
  }
  return bucket.count >= limit;
}

/**
 * Check-then-consume across principal/store/global. Returns false (and writes
 * nothing) when any scope is saturated; otherwise consumes one unit from each.
 */
export async function tryConsumeMovementAdmission(
  ctx: Pick<MutationCtx, "db">,
  args: { principalKey: string; storeKey: string; now: number },
): Promise<boolean> {
  const scoped: Array<{ scope: AdmissionScope; key: string }> = [
    { scope: "principal", key: args.principalKey },
    { scope: "store", key: args.storeKey },
    { scope: "global", key: "global" },
  ];

  const buckets = await Promise.all(
    scoped.map((entry) => readAdmissionBucket(ctx, entry.scope, entry.key)),
  );
  if (
    scoped.some((entry, index) =>
      bucketSaturated(buckets[index], ADMISSION_LIMITS[entry.scope], args.now),
    )
  ) {
    return false;
  }

  for (const [index, entry] of scoped.entries()) {
    const bucket = buckets[index];
    if (
      !bucket ||
      bucket.windowStartedAt <= args.now - MOVEMENT_ADMISSION_WINDOW_MS
    ) {
      if (bucket) {
        await ctx.db.replace("reportMovementAdmission", bucket._id, {
          scope: entry.scope,
          key: entry.key,
          windowStartedAt: args.now,
          count: 1,
        });
      } else {
        await ctx.db.insert("reportMovementAdmission", {
          scope: entry.scope,
          key: entry.key,
          windowStartedAt: args.now,
          count: 1,
        });
      }
      continue;
    }
    await ctx.db.patch("reportMovementAdmission", bucket._id, {
      count: bucket.count + 1,
    });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Ensure — the idempotent public admission boundary.
// ---------------------------------------------------------------------------

export type MovementEnsureResult = {
  /** Present only when a durable request row exists for this identity. */
  requestKey: string | null;
  lifecycle: ReportMovementLifecycle;
};

function jitteredRetryAfterMs(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * MOVEMENT_RETRY_JITTER_MS);
}

function opaqueCorrelationId(seed: string): string {
  return stableStringHash(`${seed}:${Date.now()}:${Math.random()}`);
}

type EnsureCoreArgs = {
  storeId: Id<"store">;
  /** Stable per-caller admission key — the authenticated athenaUser id. */
  principalKey: string;
  startDate: string;
  endDate: string;
  now?: number;
};

/**
 * The access-checked core (testable-core / thin-wrapper split, as in
 * customRange.requestRangeCore). Order of gates:
 *   1. sweep-allowlist enablement → sanitized `not_available`, no write;
 *   2. strict per-kind range validation (throws);
 *   3. bounded revision-vector read → `waiting` when any included day is
 *      dirty or uncertified, no write;
 *   4. dedupe by movement request key → reuse an unexpired request without
 *      consuming admission budget (duplicate ensures and StrictMode effects
 *      must be idempotent, so reuse is checked BEFORE admission);
 *   5. admission windows → `backpressure`, no write;
 *   6. insert the queued header and schedule the worker action.
 */
export async function ensureMovementRangeCore(
  ctx: MutationCtx,
  args: EnsureCoreArgs,
): Promise<MovementEnsureResult> {
  const now = args.now ?? Date.now();

  // 1. A store outside the sweep allowlist can never certify source days, so
  // waiting would be forever. Sanitized, non-retrying, and checked before
  // validation so a disabled store's behavior discloses nothing else.
  if (!readStoreAllowlist().has(String(args.storeId))) {
    return { requestKey: null, lifecycle: { state: "not_available" } };
  }

  // 2. Strict dates + the movement span ceiling (92 inclusive days).
  validateReportRangeRequest("sku_movement", args.startDate, args.endDate);

  // 3. Bounded pre-admission snapshot (≤ 92 reportDay rows + dirty probe).
  const snapshot = await readMovementRevisionVector(
    ctx,
    args.storeId,
    args.startDate,
    args.endDate,
  );
  if (!snapshot.ready) {
    return {
      requestKey: null,
      lifecycle: {
        state: "waiting",
        retryAfterMs: jitteredRetryAfterMs(MOVEMENT_WAITING_RETRY_MS),
      },
    };
  }

  const requestKey = computeMovementRequestKey(
    {
      storeId: String(args.storeId),
      startDate: args.startDate,
      endDate: args.endDate,
      foldVersion: REPORTS_FOLD_VERSION,
      contractVersion: REPORT_MOVEMENT_CONTRACT_VERSION,
      revisionVector: snapshot.revisionVector,
    },
    stableStringHash,
  );

  // 4. Deduplicate. An unexpired request with this exact identity — pending,
  // completed, or terminal — is THE request; duplicate ensure calls reuse it
  // without another write, schedule, or admission charge.
  const existing = await ctx.db
    .query("reportRangeResult")
    .withIndex("by_storeId_requestKey", (q) =>
      q.eq("storeId", args.storeId).eq("requestKey", requestKey),
    )
    .unique();
  if (existing) {
    if (existing.expiresAt > now && existing.movementPhase !== "cleaning") {
      return {
        requestKey,
        lifecycle: deriveMovementRequestLifecycle(existing),
      };
    }
    // Expired (or draining) row with the same identity: cleanup owns its
    // child-first deletion, and inserting beside it would break the
    // (store, requestKey) uniqueness every reader relies on. Wait it out.
    return {
      requestKey: null,
      lifecycle: {
        state: "waiting",
        retryAfterMs: jitteredRetryAfterMs(MOVEMENT_WAITING_RETRY_MS),
      },
    };
  }

  // 5. Admission windows — checked before any write, consumed only on admit.
  const admitted = await tryConsumeMovementAdmission(ctx, {
    principalKey: args.principalKey,
    storeKey: String(args.storeId),
    now,
  });
  if (!admitted) {
    return {
      requestKey: null,
      lifecycle: {
        state: "backpressure",
        retryAfterMs: jitteredRetryAfterMs(MOVEMENT_BACKPRESSURE_RETRY_MS),
      },
    };
  }

  // 6. Durable queued header + prompt continuation. The backstop only needs
  // to act when this schedule is dropped, so eligibility starts one stall
  // window out rather than immediately.
  const rangeResultId = await ctx.db.insert("reportRangeResult", {
    storeId: args.storeId,
    requestKey,
    startDate: args.startDate,
    endDate: args.endDate,
    status: "pending",
    kind: "sku_movement",
    movementPhase: "queued",
    movementContractVersion: REPORT_MOVEMENT_CONTRACT_VERSION,
    movementRevisionVector: snapshot.revisionVector,
    movementAttempt: 0,
    movementEligibleAt: now + MOVEMENT_STALL_RECOVERY_MS,
    movementFence: 1,
    movementSourceDayCursor: args.startDate,
    requestedAt: now,
    expiresAt: now + REPORT_RANGE_TTL_MS,
    foldVersion: REPORTS_FOLD_VERSION,
  });
  await ctx.scheduler.runAfter(0, MOVEMENT_WORKER_REF, {
    rangeResultId,
    expectedPhase: "queued",
    expectedFence: 1,
  });

  return { requestKey, lifecycle: { state: "queued_pending" } };
}

export const ensureMovementRange = mutation({
  args: {
    storeId: v.id("store"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args): Promise<MovementEnsureResult> => {
    // Generation authority: shared-demo actors are denied server-side
    // (reporting.generate is not a demo-allowed capability), independent of
    // any client demo gating; then the full-admin reports gate runs.
    await requireSharedDemoCapabilityIfApplicable(ctx, "reporting.generate");
    const { athenaUser } = await requireReportsStoreAccess(ctx, args.storeId);
    return ensureMovementRangeCore(ctx, {
      storeId: args.storeId,
      principalKey: String(athenaUser._id),
      startDate: args.startDate,
      endDate: args.endDate,
    });
  },
});

// ---------------------------------------------------------------------------
// Retry — a NEW fenced attempt for an unexpired terminal request, never the
// same failed row's state. Recomputes the admission snapshot first: a
// source-stale terminal naturally yields a successor request (different key)
// instead of re-running an identity that can never publish.
// ---------------------------------------------------------------------------

export const retryMovementRange = mutation({
  args: { storeId: v.id("store"), requestKey: v.string() },
  handler: async (ctx, args): Promise<MovementEnsureResult> => {
    await requireSharedDemoCapabilityIfApplicable(ctx, "reporting.generate");
    const { athenaUser } = await requireReportsStoreAccess(ctx, args.storeId);
    return retryTerminalMovementRequest(ctx, {
      storeId: args.storeId,
      requestKey: args.requestKey,
      principalKey: String(athenaUser._id),
    });
  },
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
  const now = args.now ?? Date.now();

  if (!readStoreAllowlist().has(String(args.storeId))) {
    return { requestKey: null, lifecycle: { state: "not_available" } };
  }

  const existing = await ctx.db
    .query("reportRangeResult")
    .withIndex("by_storeId_requestKey", (q) =>
      q.eq("storeId", args.storeId).eq("requestKey", args.requestKey),
    )
    .unique();
  if (
    !existing ||
    existing.kind !== "sku_movement" ||
    existing.expiresAt <= now
  ) {
    return {
      requestKey: null,
      lifecycle: {
        state: "waiting",
        retryAfterMs: jitteredRetryAfterMs(MOVEMENT_WAITING_RETRY_MS),
      },
    };
  }
  if (existing.movementPhase !== "terminal_error") {
    // Not terminal — behave like an idempotent ensure on the same row.
    return {
      requestKey: existing.requestKey,
      lifecycle: deriveMovementRequestLifecycle(existing),
    };
  }

  const snapshot = await readMovementRevisionVector(
    ctx,
    args.storeId,
    existing.startDate,
    existing.endDate,
  );
  if (!snapshot.ready) {
    return {
      requestKey: null,
      lifecycle: {
        state: "waiting",
        retryAfterMs: jitteredRetryAfterMs(MOVEMENT_WAITING_RETRY_MS),
      },
    };
  }

  const currentKey = computeMovementRequestKey(
    {
      storeId: String(args.storeId),
      startDate: existing.startDate,
      endDate: existing.endDate,
      foldVersion: REPORTS_FOLD_VERSION,
      contractVersion: REPORT_MOVEMENT_CONTRACT_VERSION,
      revisionVector: snapshot.revisionVector,
    },
    stableStringHash,
  );

  if (currentKey !== existing.requestKey) {
    // Source moved on — the failed identity can never publish. Admit the
    // successor through the normal gates (dedupe, admission, schedule).
    return ensureMovementRangeCore(ctx, {
      storeId: args.storeId,
      principalKey: args.principalKey,
      startDate: existing.startDate,
      endDate: existing.endDate,
      now,
    });
  }

  // Same identity: retries create work, so they pay admission like a new
  // request; then the row is reset in place under a NEW fence.
  const admitted = await tryConsumeMovementAdmission(ctx, {
    principalKey: args.principalKey,
    storeKey: String(args.storeId),
    now,
  });
  if (!admitted) {
    return {
      requestKey: null,
      lifecycle: {
        state: "backpressure",
        retryAfterMs: jitteredRetryAfterMs(MOVEMENT_BACKPRESSURE_RETRY_MS),
      },
    };
  }

  const fence = (existing.movementFence ?? 0) + 1;
  await ctx.db.patch("reportRangeResult", existing._id, {
    status: "pending",
    movementPhase: "queued",
    movementAttempt: 0,
    movementEligibleAt: now + MOVEMENT_STALL_RECOVERY_MS,
    movementFence: fence,
    movementSourceDayCursor: existing.startDate,
    movementTotals: undefined,
    movementErrorCode: undefined,
    movementCorrelationId: undefined,
    computedAt: undefined,
  });
  await ctx.scheduler.runAfter(0, MOVEMENT_WORKER_REF, {
    rangeResultId: existing._id,
    expectedPhase: "queued",
    expectedFence: fence,
  });
  return {
    requestKey: existing.requestKey,
    lifecycle: { state: "queued_pending" },
  };
}

// ---------------------------------------------------------------------------
// The fenced batch state machine. Every committed batch advances the fence,
// so a stale or duplicate worker — same expected {phase, fence} applied
// twice, or a superseded attempt — observes a mismatch and no-ops.
// ---------------------------------------------------------------------------

export type MovementBatchIntent =
  | {
      next: "continue";
      phase: ReportMovementRequestPhase;
      fence: number;
    }
  | { next: "done" }
  | { next: "stale" };

const ZERO_TOTALS: ReportMovementTotals = {
  unitsSold: 0,
  unitsReturned: 0,
  netUnits: 0,
  skuCount: 0,
};

type BatchArgs = {
  rangeResultId: Id<"reportRangeResult">;
  expectedPhase: string;
  expectedFence: number;
  now?: number;
};

async function terminalSourceStale(
  ctx: MutationCtx,
  row: Doc<"reportRangeResult">,
  now: number,
): Promise<MovementBatchIntent> {
  await ctx.db.patch("reportRangeResult", row._id, {
    status: "failed",
    movementPhase: "terminal_error",
    movementErrorCode: MOVEMENT_ERROR_CODE_SOURCE_STALE,
    movementCorrelationId: opaqueCorrelationId(String(row._id)),
    movementEligibleAt: undefined,
    movementFence: (row.movementFence ?? 0) + 1,
    // Erase the ranking pass's running accumulator: a terminal row carries
    // no totals at all, partial or otherwise.
    movementTotals: undefined,
    computedAt: now,
  });
  return { next: "done" };
}

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
  const now = args.now ?? Date.now();
  const row = await ctx.db.get("reportRangeResult", args.rangeResultId);
  if (
    !row ||
    row.kind !== "sku_movement" ||
    row.movementPhase !== args.expectedPhase ||
    row.movementFence !== args.expectedFence
  ) {
    return { next: "stale" };
  }
  if (row.expiresAt <= now) return { next: "stale" };

  const fence = args.expectedFence + 1;

  switch (row.movementPhase) {
    case "queued": {
      // Reset lane: clear any children left by a superseded attempt so
      // accumulation can never double-count. Fresh requests have none and
      // fall straight through to aggregation.
      const children = await ctx.db
        .query("reportRangeMovementSku")
        .withIndex("by_storeId_rangeResultId_productSkuId", (q) =>
          q.eq("storeId", row.storeId).eq("rangeResultId", row._id),
        )
        .take(MOVEMENT_RESET_CHILD_BATCH);
      for (const child of children) {
        await ctx.db.delete("reportRangeMovementSku", child._id);
      }
      const phase =
        children.length === MOVEMENT_RESET_CHILD_BATCH
          ? ("queued" as const)
          : ("aggregating" as const);
      await ctx.db.patch("reportRangeResult", row._id, {
        movementPhase: phase,
        movementFence: fence,
        movementEligibleAt: now + MOVEMENT_STALL_RECOVERY_MS,
      });
      return { next: "continue", phase, fence };
    }

    case "aggregating": {
      const operatingDate = row.movementSourceDayCursor;
      const vector = row.movementRevisionVector ?? [];
      const dayIndex = vector.findIndex(
        (entry) => entry.operatingDate === operatingDate,
      );
      if (operatingDate === undefined || dayIndex < 0) {
        throw new Error(
          `movement request ${row._id} has an inconsistent source cursor`,
        );
      }
      const expected = vector[dayIndex]!;

      // Verify this day still IS the admitted generation before touching it.
      const dirty = await ctx.db
        .query("reportDirtyDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", row.storeId).eq("operatingDate", operatingDate),
        )
        .first();
      if (dirty) return terminalSourceStale(ctx, row, now);

      const day = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", row.storeId).eq("operatingDate", operatingDate),
        )
        .unique();
      const admissible = admissibleMovementDayRevision(operatingDate, day);
      if (
        admissible === null ||
        admissible.revision !== expected.revision
      ) {
        return terminalSourceStale(ctx, row, now);
      }

      if (expected.revision !== REPORT_MOVEMENT_EMPTY_DAY_REVISION) {
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
          if (
            !movementSourceRowMatchesRevision(expected.revision, source)
          ) {
            return terminalSourceStale(ctx, row, now);
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
          const unitsReturned =
            (child?.unitsReturned ?? 0) + source.unitsReturned;
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
      }

      const nextEntry = vector[dayIndex + 1];
      const phase = nextEntry ? ("aggregating" as const) : ("ranking" as const);
      await ctx.db.patch("reportRangeResult", row._id, {
        movementPhase: phase,
        movementFence: fence,
        movementEligibleAt: now + MOVEMENT_STALL_RECOVERY_MS,
        movementSourceDayCursor: nextEntry?.operatingDate,
        // Running accumulator for the ranking pass; authoritative only once
        // the completed phase is reached.
        ...(phase === "ranking" ? { movementTotals: ZERO_TOTALS } : {}),
      });
      return { next: "continue", phase, fence };
    }

    case "ranking": {
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
        await ctx.db.patch("reportRangeResult", row._id, {
          movementFence: fence,
          movementEligibleAt: now + MOVEMENT_STALL_RECOVERY_MS,
          movementTotals: totals,
        });
        return { next: "continue", phase: "ranking", fence };
      }

      // Finalization: publish ONLY when a fresh bounded recheck still sees
      // the exact clean revision vector the request admitted.
      const recheck = await readMovementRevisionVector(
        ctx,
        row.storeId,
        row.startDate,
        row.endDate,
      );
      if (
        !recheck.ready ||
        !sameRevisionVector(
          recheck.revisionVector,
          row.movementRevisionVector ?? [],
        )
      ) {
        // Totals from this batch are irrelevant on the terminal path.
        return terminalSourceStale(ctx, row, now);
      }

      await ctx.db.patch("reportRangeResult", row._id, {
        status: "completed",
        movementPhase: "completed",
        movementFence: fence,
        movementTotals: totals,
        movementEligibleAt: undefined,
        movementSourceDayCursor: undefined,
        computedAt: now,
      });
      return { next: "done" };
    }

    case "retry_wait": {
      // Resume lane. The failed batch rolled back atomically, so durable
      // state tells us where to re-enter:
      //   cursor unset            → ranking (resumes off max assigned rank);
      //   cursor at startDate AND children exist → a superseded attempt's
      //     children still need the queued reset before re-aggregation;
      //   otherwise               → aggregating at the cursor.
      let phase: ReportMovementRequestPhase;
      if (row.movementSourceDayCursor === undefined) {
        phase = "ranking";
      } else if (row.movementSourceDayCursor === row.startDate) {
        const anyChild = await ctx.db
          .query("reportRangeMovementSku")
          .withIndex("by_storeId_rangeResultId_productSkuId", (q) =>
            q.eq("storeId", row.storeId).eq("rangeResultId", row._id),
          )
          .first();
        phase = anyChild ? "queued" : "aggregating";
      } else {
        phase = "aggregating";
      }
      await ctx.db.patch("reportRangeResult", row._id, {
        movementPhase: phase,
        movementFence: fence,
        movementEligibleAt: now + MOVEMENT_STALL_RECOVERY_MS,
      });
      return { next: "continue", phase, fence };
    }

    case "completed":
    case "terminal_error":
    case "cleaning":
      return { next: "stale" };
  }
  return { next: "stale" };
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
  return Math.min(
    MOVEMENT_RETRY_MAX_MS,
    MOVEMENT_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1),
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
  const now = args.now ?? Date.now();
  const row = await ctx.db.get("reportRangeResult", args.rangeResultId);
  if (
    !row ||
    row.kind !== "sku_movement" ||
    row.movementFence !== args.expectedFence ||
    !ACTIVE_MOVEMENT_PHASES.includes(row.movementPhase ?? "completed")
  ) {
    // Another worker progressed (or the row is settled) — the failure being
    // reported belongs to a superseded attempt.
    return { recorded: false };
  }

  const attempt = (row.movementAttempt ?? 0) + 1;
  const fence = args.expectedFence + 1;

  if (attempt >= MOVEMENT_MAX_ATTEMPTS) {
    const correlationId = opaqueCorrelationId(String(row._id));
    await ctx.db.patch("reportRangeResult", row._id, {
      status: "failed",
      movementPhase: "terminal_error",
      movementAttempt: attempt,
      movementFence: fence,
      movementErrorCode: MOVEMENT_ERROR_CODE_WORKER_FAILED,
      movementCorrelationId: correlationId,
      movementEligibleAt: undefined,
      computedAt: now,
    });
    return { recorded: true, correlationId };
  }

  await ctx.db.patch("reportRangeResult", row._id, {
    movementPhase: "retry_wait",
    movementAttempt: attempt,
    movementFence: fence,
    movementEligibleAt: now + movementRetryBackoffMs(attempt),
  });
  return { recorded: true };
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
// Sweeper hooks — invoked UNCONDITIONALLY from sweepWithCtx (never gated on
// touchedStores). Scheduling and deletion only; no aggregation happens here.
// ---------------------------------------------------------------------------

/**
 * The cron backstop: schedule workers for movement rows whose eligibility
 * time has passed. Budgeted per tick, and each scheduled row's eligibility is
 * pushed one stall window out so a poison row cannot monopolize every tick —
 * capped attempts move it to terminal instead.
 */
export async function scheduleEligibleMovementWork(
  ctx: MutationCtx,
  now: number,
): Promise<number> {
  const eligible = await ctx.db
    .query("reportRangeResult")
    .withIndex("by_movementEligibleAt", (q) =>
      q.gte("movementEligibleAt", 1).lte("movementEligibleAt", now),
    )
    .take(MOVEMENT_BACKSTOP_SCHEDULES_PER_TICK);

  let scheduled = 0;
  for (const row of eligible) {
    if (
      row.kind !== "sku_movement" ||
      row.movementPhase === undefined ||
      !ACTIVE_MOVEMENT_PHASES.includes(row.movementPhase)
    ) {
      // Settled or foreign rows must leave the eligible index either way.
      await ctx.db.patch("reportRangeResult", row._id, {
        movementEligibleAt: undefined,
      });
      continue;
    }
    if (row.expiresAt <= now) {
      await ctx.db.patch("reportRangeResult", row._id, {
        movementEligibleAt: undefined,
      });
      continue;
    }
    await ctx.db.patch("reportRangeResult", row._id, {
      movementEligibleAt: now + MOVEMENT_STALL_RECOVERY_MS,
    });
    await ctx.scheduler.runAfter(0, MOVEMENT_WORKER_REF, {
      rangeResultId: row._id,
      expectedPhase: row.movementPhase,
      expectedFence: row.movementFence ?? 0,
    });
    scheduled += 1;
  }
  return scheduled;
}

export type MovementCleanupResult = {
  childrenDeleted: number;
  headersDeleted: number;
  headersCleaning: number;
};

/**
 * Child-first cleanup of expired movement snapshots. Children carry their own
 * `expiresAt`, so they are found directly through `by_expiresAt` without
 * loading headers; a header is deleted only once none of its children remain,
 * passing through the explicit `cleaning` phase while they drain.
 */
export async function cleanupExpiredMovement(
  ctx: MutationCtx,
  now: number,
): Promise<MovementCleanupResult> {
  const result: MovementCleanupResult = {
    childrenDeleted: 0,
    headersDeleted: 0,
    headersCleaning: 0,
  };

  const expiredChildren = await ctx.db
    .query("reportRangeMovementSku")
    .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
    .take(MOVEMENT_CLEANUP_CHILD_BATCH);
  for (const child of expiredChildren) {
    await ctx.db.delete("reportRangeMovementSku", child._id);
  }
  result.childrenDeleted = expiredChildren.length;

  const expiredHeaders = await ctx.db
    .query("reportRangeResult")
    .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
    .take(MOVEMENT_CLEANUP_HEADER_BATCH);
  for (const header of expiredHeaders) {
    if (header.kind !== "sku_movement") continue; // legacy expiry owns these
    const remaining = await ctx.db
      .query("reportRangeMovementSku")
      .withIndex("by_storeId_rangeResultId_productSkuId", (q) =>
        q.eq("storeId", header.storeId).eq("rangeResultId", header._id),
      )
      .first();
    if (remaining) {
      if (header.movementPhase !== "cleaning") {
        await ctx.db.patch("reportRangeResult", header._id, {
          movementPhase: "cleaning",
          movementEligibleAt: undefined,
        });
      }
      result.headersCleaning += 1;
      continue;
    }
    await ctx.db.delete("reportRangeResult", header._id);
    result.headersDeleted += 1;
  }

  return result;
}

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
  if (!row || row.kind !== "sku_movement") return null;
  if (row.expiresAt <= now || row.movementPhase === "cleaning") return null;
  return row;
}

/**
 * Lightweight lifecycle subscription for an admitted request — no rows, so
 * an open sheet can track queued/completed/terminal cheaply and switch to
 * the page reader once completed. Read budget: 1 header doc.
 */
export const getMovementRange = query({
  args: { storeId: v.id("store"), requestKey: v.string() },
  handler: async (ctx, args): Promise<MovementRangeStatus> => {
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
  handler: async (ctx, args): Promise<MovementRangePage> => {
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
});
