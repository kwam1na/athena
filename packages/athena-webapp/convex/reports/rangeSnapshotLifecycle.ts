import type { FunctionReference } from "convex/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  REPORTS_FOLD_VERSION,
  REPORT_MOVEMENT_EMPTY_DAY_REVISION,
  REPORT_RANGE_TTL_MS,
  admissibleMovementDayRevision,
  type ReportMovementDayRevision,
  type ReportMovementRequestPhase,
  type ReportRangeKind,
} from "../../shared/reportsContract";
import { readStoreAllowlist } from "./sweeper";
import { addDaysToDate } from "./rollups";
import { stableStringHash } from "./fingerprint";

/**
 * The kind-generic bounded-resumable-range-snapshot lifecycle (U3).
 *
 * `reports/skuMovementRange.ts` shipped this machinery bound to the
 * `"sku_movement"` literal. This module extracts the kind-generic seams —
 * gate ordering (allowlist → validate → revision vector → dedupe → admission
 * → insert + schedule), phase/fence transitions, retry and backoff,
 * eligible-work scheduling, the sweeper backstop, child-first cleanup, and
 * sanitized error mapping — behind one per-kind configuration
 * (`RangeSnapshotKindConfig`), so a third consumer (`sku_mix`, U4) is
 * configuration rather than duplication.
 *
 * Kind-specific behavior lives in the config: source projection + child
 * writer (`aggregateSourceDay`), child bookkeeping, the totals accumulator
 * (inside `runRankingBatch` for movement; header-side during aggregation for
 * kinds without a ranking phase), the phase set (`hasRankingPhase` — a kind
 * may omit ranking and transition aggregating → completed directly), and
 * every batch/admission/backoff/cleanup constant.
 *
 * Naming note: the shared header columns (`movementPhase`, `movementFence`,
 * `movementEligibleAt`, …) and the `reportMovementAdmission` table keep their
 * historical `movement` names — they were introduced by the movement
 * lifecycle and renaming stored columns would be a migration for zero
 * behavioral benefit. Any kinded row uses them as its generic lifecycle rail.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/**
 * The generic phase vocabulary is the superset movement established; a kind
 * without a ranking phase simply never enters `"ranking"`.
 */
export type RangeSnapshotPhase = ReportMovementRequestPhase;

/** Phases the backstop may reschedule and the failure lane may act on. */
export const ACTIVE_RANGE_SNAPSHOT_PHASES: readonly RangeSnapshotPhase[] = [
  "queued",
  "aggregating",
  "ranking",
  "retry_wait",
];

/**
 * Eligible workers the sweeper backstop schedules per tick. A shared-scan
 * budget (the `by_movementEligibleAt` index is one queue across kinds), not a
 * per-kind constant.
 */
export const RANGE_SNAPSHOT_BACKSTOP_SCHEDULES_PER_TICK = 5;

/** Expired snapshot headers examined per sweep tick (shared header scan). */
export const RANGE_SNAPSHOT_CLEANUP_HEADER_BATCH = 10;

/**
 * Ensure/retry lifecycle states the generic machinery produces itself. Each
 * kind's own lifecycle union (movement's `ReportMovementLifecycle`, mix's in
 * U4) must include these members; `deriveLifecycle` supplies the rest.
 */
export type RangeSnapshotTransientLifecycle =
  | { state: "not_available" }
  | { state: "waiting"; retryAfterMs: number }
  | { state: "backpressure"; retryAfterMs: number }
  | { state: "queued_pending" };

export type RangeSnapshotEnsureResult<Lifecycle> = {
  /** Present only when a durable request row exists for this identity. */
  requestKey: string | null;
  lifecycle: Lifecycle | RangeSnapshotTransientLifecycle;
};

export type RangeSnapshotBatchIntent =
  | { next: "continue"; phase: RangeSnapshotPhase; fence: number }
  | { next: "done" }
  | { next: "stale" };

export type RangeSnapshotRankingOutcome =
  | {
      done: false;
      /** Merged into the generic continue patch (fence + eligibility). */
      headerPatch?: Partial<Doc<"reportRangeResult">>;
    }
  | {
      done: true;
      /** Merged into the generic completion patch after the vector recheck. */
      completionPatch?: Partial<Doc<"reportRangeResult">>;
    };

// ---------------------------------------------------------------------------
// The per-kind configuration — the seam U4 builds on.
// ---------------------------------------------------------------------------

export type RangeSnapshotKindConfig<Lifecycle> = {
  /** The `reportRangeResult.kind` literal this lifecycle owns. */
  kind: ReportRangeKind;
  /** Contract version stamped on the header at admission. */
  contractVersion: number;
  /** Inclusive-day scan bound for the bounded revision-vector read. */
  maxRangeDays: number;
  /**
   * Whether this kind runs the ranking phase. When false, the last
   * aggregation batch runs the publication recheck itself and transitions
   * aggregating → completed directly.
   */
  hasRankingPhase: boolean;
  /** The kind's continuation worker action (self-scheduling chain target).
   * (Visibility is a union because `makeFunctionReference` types path-built
   * refs as "public"; the referenced function itself is an internalAction.) */
  workerRef: FunctionReference<
    "action",
    "public" | "internal",
    {
      rangeResultId: Id<"reportRangeResult">;
      expectedPhase: string;
      expectedFence: number;
    }
  >;
  /**
   * Admission bucket key scope. Non-empty scopes key every bucket as
   * `"<scope>:<raw key>"`, isolating this kind's budgets at all three scopes
   * (`principal`, `store`, `global`). Movement supplies `""` — its
   * production buckets predate kind scoping and raw Convex-id keys can never
   * collide with a `"<kind>:"`-prefixed key (ids and the `"global"` literal
   * contain no colon). Every kind added after movement MUST use its own kind
   * string here. No migration accompanies scoping: buckets are fixed
   * `admissionWindowMs` windows, so rows under a superseded key age out
   * within one window.
   */
  admissionKeyScope: string;
  constants: {
    /** Untouched-active-row window before the backstop rescues the row. */
    stallRecoveryMs: number;
    /** Worker failures tolerated before the request goes terminal. */
    maxAttempts: number;
    /** Retry backoff: base doubling per attempt, capped at `retryMaxMs`. */
    retryBaseMs: number;
    retryMaxMs: number;
    /** Server-chosen ensure polling intervals (plus shared jitter). */
    waitingRetryMs: number;
    backpressureRetryMs: number;
    retryJitterMs: number;
    /** Stale children deleted per reset ("queued") batch. */
    resetChildBatch: number;
    /** Expired child rows deleted per sweep tick (child-first cleanup). */
    cleanupChildBatch: number;
    /** Fixed admission window and its per-scope budgets. */
    admissionWindowMs: number;
    admissionsPerPrincipal: number;
    admissionsPerStore: number;
    admissionsGlobal: number;
  };
  /** Sanitized terminal codes — the only error identities clients see. */
  errorCodes: { workerFailed: string; sourceStale: string };
  /** Strict per-kind range validation (throws). */
  validateRange(startDate: string, endDate: string): void;
  /** Durable request identity for this kind (kind-prefixed key). */
  computeRequestKey(args: {
    storeId: string;
    startDate: string;
    endDate: string;
    revisionVector: ReportMovementDayRevision[];
  }): string;
  /** Public lifecycle projection for an admitted header row. */
  deriveLifecycle(row: Doc<"reportRangeResult">): Lifecycle;
  /** Child-table bookkeeping — the kind owns its child rows entirely. */
  children: {
    /** Delete up to `limit` children of this request; returns the count. */
    deleteStaleBatch(
      ctx: MutationCtx,
      row: Doc<"reportRangeResult">,
      limit: number,
    ): Promise<number>;
    /** Whether any child rows exist for this request (resume probe). */
    hasAny(
      ctx: MutationCtx,
      row: Doc<"reportRangeResult">,
    ): Promise<boolean>;
    /** Delete up to `limit` children with `expiresAt < now`; returns count. */
    deleteExpiredBatch(
      ctx: MutationCtx,
      now: number,
      limit: number,
    ): Promise<number>;
  };
  /**
   * Source projection + child writer for one admitted operating day. The
   * generic machinery has already verified the day is neither dirty nor on a
   * different certified revision; this hook owns the bounded source read and
   * the kind's accumulation writes. Return `"source_stale"` to send the
   * request to the sanitized source-stale terminal; throw on defects (the
   * batch rolls back whole and the failure lane records retry metadata).
   */
  aggregateSourceDay(
    ctx: MutationCtx,
    row: Doc<"reportRangeResult">,
    expected: ReportMovementDayRevision,
  ): Promise<"ok" | "source_stale">;
  /**
   * Header patch applied when aggregation finishes and the kind enters
   * ranking (e.g. movement seeds its running totals accumulator). Ignored
   * for kinds without a ranking phase.
   */
  onEnterRanking?(
    row: Doc<"reportRangeResult">,
  ): Partial<Doc<"reportRangeResult">>;
  /**
   * One bounded ranking batch. Required when `hasRankingPhase`. The generic
   * machinery applies fencing around the outcome and runs the publication
   * recheck once the outcome reports `done`.
   */
  runRankingBatch?(
    ctx: MutationCtx,
    row: Doc<"reportRangeResult">,
  ): Promise<RangeSnapshotRankingOutcome>;
  /**
   * Header patch merged into the completion write for kinds WITHOUT a
   * ranking phase (kinds with one publish through `runRankingBatch`'s
   * `completionPatch`).
   */
  completionPatch?(
    row: Doc<"reportRangeResult">,
  ): Partial<Doc<"reportRangeResult">>;
};

// ---------------------------------------------------------------------------
// Bounded pre-admission snapshot: the revision-vector read that runs on
// EVERY ensure call. Budget: ≤ `maxRangeDays` reportDay rows + one
// dirty-marker existence probe, both on store-prefixed indexes.
// ---------------------------------------------------------------------------

export type RangeSnapshotAdmissionSnapshot =
  | { ready: false }
  | { ready: true; revisionVector: ReportMovementDayRevision[] };

export async function readRangeRevisionVector(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  storeId: Id<"store">,
  startDate: string,
  endDate: string,
  maxRangeDays: number,
): Promise<RangeSnapshotAdmissionSnapshot> {
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
    .take(maxRangeDays);

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

function scopedAdmissionKey(
  config: Pick<RangeSnapshotKindConfig<unknown>, "admissionKeyScope">,
  rawKey: string,
): string {
  // Kind-scoped bucket keys isolate per-kind budgets at every scope. See
  // `admissionKeyScope` on the config type for the movement grandfathering
  // and the no-migration rationale.
  return config.admissionKeyScope
    ? `${config.admissionKeyScope}:${rawKey}`
    : rawKey;
}

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
  windowMs: number,
  now: number,
): boolean {
  if (!bucket) return false;
  if (bucket.windowStartedAt <= now - windowMs) return false;
  return bucket.count >= limit;
}

/**
 * Check-then-consume across principal/store/global for one kind. Returns
 * false (and writes nothing) when any scope is saturated; otherwise consumes
 * one unit from each.
 */
export async function tryConsumeRangeSnapshotAdmission<Lifecycle>(
  ctx: Pick<MutationCtx, "db">,
  config: RangeSnapshotKindConfig<Lifecycle>,
  args: { principalKey: string; storeKey: string; now: number },
): Promise<boolean> {
  const { admissionWindowMs } = config.constants;
  const limits: Record<AdmissionScope, number> = {
    principal: config.constants.admissionsPerPrincipal,
    store: config.constants.admissionsPerStore,
    global: config.constants.admissionsGlobal,
  };
  const scoped: Array<{ scope: AdmissionScope; key: string }> = [
    { scope: "principal", key: scopedAdmissionKey(config, args.principalKey) },
    { scope: "store", key: scopedAdmissionKey(config, args.storeKey) },
    { scope: "global", key: scopedAdmissionKey(config, "global") },
  ];

  const buckets = await Promise.all(
    scoped.map((entry) => readAdmissionBucket(ctx, entry.scope, entry.key)),
  );
  if (
    scoped.some((entry, index) =>
      bucketSaturated(
        buckets[index],
        limits[entry.scope],
        admissionWindowMs,
        args.now,
      ),
    )
  ) {
    return false;
  }

  for (const [index, entry] of scoped.entries()) {
    const bucket = buckets[index];
    if (!bucket || bucket.windowStartedAt <= args.now - admissionWindowMs) {
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
// Ensure — the idempotent admission core behind each kind's public mutation.
// ---------------------------------------------------------------------------

function jitteredRetryAfterMs(baseMs: number, jitterMs: number): number {
  return baseMs + Math.floor(Math.random() * jitterMs);
}

function opaqueCorrelationId(seed: string): string {
  return stableStringHash(`${seed}:${Date.now()}:${Math.random()}`);
}

function waitingLifecycle<Lifecycle>(
  config: RangeSnapshotKindConfig<Lifecycle>,
): RangeSnapshotEnsureResult<Lifecycle> {
  return {
    requestKey: null,
    lifecycle: {
      state: "waiting",
      retryAfterMs: jitteredRetryAfterMs(
        config.constants.waitingRetryMs,
        config.constants.retryJitterMs,
      ),
    },
  };
}

function backpressureLifecycle<Lifecycle>(
  config: RangeSnapshotKindConfig<Lifecycle>,
): RangeSnapshotEnsureResult<Lifecycle> {
  return {
    requestKey: null,
    lifecycle: {
      state: "backpressure",
      retryAfterMs: jitteredRetryAfterMs(
        config.constants.backpressureRetryMs,
        config.constants.retryJitterMs,
      ),
    },
  };
}

export type RangeSnapshotEnsureArgs = {
  storeId: Id<"store">;
  /** Stable per-caller admission key — the authenticated athenaUser id. */
  principalKey: string;
  startDate: string;
  endDate: string;
  now?: number;
};

/**
 * The access-checked ensure core (testable-core / thin-wrapper split). Order
 * of gates:
 *   1. sweep-allowlist enablement → sanitized `not_available`, no write;
 *   2. strict per-kind range validation (throws);
 *   3. bounded revision-vector read → `waiting` when any included day is
 *      dirty or uncertified, no write;
 *   4. dedupe by request key → reuse an unexpired request without consuming
 *      admission budget (duplicate ensures and StrictMode effects must be
 *      idempotent, so reuse is checked BEFORE admission);
 *   5. admission windows → `backpressure`, no write;
 *   6. insert the queued header and schedule the kind's worker action.
 */
export async function ensureRangeSnapshotCore<Lifecycle>(
  ctx: MutationCtx,
  config: RangeSnapshotKindConfig<Lifecycle>,
  args: RangeSnapshotEnsureArgs,
): Promise<RangeSnapshotEnsureResult<Lifecycle>> {
  const now = args.now ?? Date.now();

  // 1. A store outside the sweep allowlist can never certify source days, so
  // waiting would be forever. Sanitized, non-retrying, and checked before
  // validation so a disabled store's behavior discloses nothing else.
  if (!readStoreAllowlist().has(String(args.storeId))) {
    return { requestKey: null, lifecycle: { state: "not_available" } };
  }

  // 2. Strict dates + the kind's span ceiling.
  config.validateRange(args.startDate, args.endDate);

  // 3. Bounded pre-admission snapshot.
  const snapshot = await readRangeRevisionVector(
    ctx,
    args.storeId,
    args.startDate,
    args.endDate,
    config.maxRangeDays,
  );
  if (!snapshot.ready) return waitingLifecycle(config);

  const requestKey = config.computeRequestKey({
    storeId: String(args.storeId),
    startDate: args.startDate,
    endDate: args.endDate,
    revisionVector: snapshot.revisionVector,
  });

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
      return { requestKey, lifecycle: config.deriveLifecycle(existing) };
    }
    // Expired (or draining) row with the same identity: cleanup owns its
    // child-first deletion, and inserting beside it would break the
    // (store, requestKey) uniqueness every reader relies on. Wait it out.
    return waitingLifecycle(config);
  }

  // 5. Admission windows — checked before any write, consumed only on admit.
  const admitted = await tryConsumeRangeSnapshotAdmission(ctx, config, {
    principalKey: args.principalKey,
    storeKey: String(args.storeId),
    now,
  });
  if (!admitted) return backpressureLifecycle(config);

  // 6. Durable queued header + prompt continuation. The backstop only needs
  // to act when this schedule is dropped, so eligibility starts one stall
  // window out rather than immediately.
  const rangeResultId = await ctx.db.insert("reportRangeResult", {
    storeId: args.storeId,
    requestKey,
    startDate: args.startDate,
    endDate: args.endDate,
    status: "pending",
    kind: config.kind,
    movementPhase: "queued",
    movementContractVersion: config.contractVersion,
    movementRevisionVector: snapshot.revisionVector,
    movementAttempt: 0,
    movementEligibleAt: now + config.constants.stallRecoveryMs,
    movementFence: 1,
    movementSourceDayCursor: args.startDate,
    requestedAt: now,
    expiresAt: now + REPORT_RANGE_TTL_MS,
    foldVersion: REPORTS_FOLD_VERSION,
  });
  await ctx.scheduler.runAfter(0, config.workerRef, {
    rangeResultId,
    expectedPhase: "queued",
    expectedFence: 1,
  });

  return { requestKey, lifecycle: { state: "queued_pending" } };
}

// ---------------------------------------------------------------------------
// Retry — a NEW fenced attempt for an unexpired terminal request, never the
// same failed row's state. Recomputes the admission snapshot first: a
// source-stale terminal naturally yields a successor request (different key)
// instead of re-running an identity that can never publish.
// ---------------------------------------------------------------------------

/**
 * The retry core. If the current source revision vector still matches the
 * terminal row's identity, the SAME row is reset under a new fence (phase
 * back to queued, stale children cleared by the queued reset batch); if the
 * vector moved on, the terminal row is left for TTL cleanup and the ordinary
 * ensure path admits the successor identity.
 */
export async function retryTerminalRangeSnapshot<Lifecycle>(
  ctx: MutationCtx,
  config: RangeSnapshotKindConfig<Lifecycle>,
  args: {
    storeId: Id<"store">;
    requestKey: string;
    principalKey: string;
    now?: number;
  },
): Promise<RangeSnapshotEnsureResult<Lifecycle>> {
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
  if (!existing || existing.kind !== config.kind || existing.expiresAt <= now) {
    return waitingLifecycle(config);
  }
  if (existing.movementPhase !== "terminal_error") {
    // Not terminal — behave like an idempotent ensure on the same row.
    return {
      requestKey: existing.requestKey,
      lifecycle: config.deriveLifecycle(existing),
    };
  }

  const snapshot = await readRangeRevisionVector(
    ctx,
    args.storeId,
    existing.startDate,
    existing.endDate,
    config.maxRangeDays,
  );
  if (!snapshot.ready) return waitingLifecycle(config);

  const currentKey = config.computeRequestKey({
    storeId: String(args.storeId),
    startDate: existing.startDate,
    endDate: existing.endDate,
    revisionVector: snapshot.revisionVector,
  });

  if (currentKey !== existing.requestKey) {
    // Source moved on — the failed identity can never publish. Admit the
    // successor through the normal gates (dedupe, admission, schedule).
    return ensureRangeSnapshotCore(ctx, config, {
      storeId: args.storeId,
      principalKey: args.principalKey,
      startDate: existing.startDate,
      endDate: existing.endDate,
      now,
    });
  }

  // Same identity: retries create work, so they pay admission like a new
  // request; then the row is reset in place under a NEW fence.
  const admitted = await tryConsumeRangeSnapshotAdmission(ctx, config, {
    principalKey: args.principalKey,
    storeKey: String(args.storeId),
    now,
  });
  if (!admitted) return backpressureLifecycle(config);

  const fence = (existing.movementFence ?? 0) + 1;
  await ctx.db.patch("reportRangeResult", existing._id, {
    status: "pending",
    movementPhase: "queued",
    movementAttempt: 0,
    movementEligibleAt: now + config.constants.stallRecoveryMs,
    movementFence: fence,
    movementSourceDayCursor: existing.startDate,
    movementTotals: undefined,
    movementErrorCode: undefined,
    movementCorrelationId: undefined,
    computedAt: undefined,
  });
  await ctx.scheduler.runAfter(0, config.workerRef, {
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

export type RangeSnapshotBatchArgs = {
  rangeResultId: Id<"reportRangeResult">;
  expectedPhase: string;
  expectedFence: number;
  now?: number;
};

async function terminalSourceStale<Lifecycle>(
  ctx: MutationCtx,
  config: RangeSnapshotKindConfig<Lifecycle>,
  row: Doc<"reportRangeResult">,
  now: number,
): Promise<RangeSnapshotBatchIntent> {
  await ctx.db.patch("reportRangeResult", row._id, {
    status: "failed",
    movementPhase: "terminal_error",
    movementErrorCode: config.errorCodes.sourceStale,
    movementCorrelationId: opaqueCorrelationId(String(row._id)),
    movementEligibleAt: undefined,
    movementFence: (row.movementFence ?? 0) + 1,
    // Erase any running accumulator: a terminal row carries no totals at
    // all, partial or otherwise.
    movementTotals: undefined,
    computedAt: now,
  });
  return { next: "done" };
}

/**
 * Publication: complete ONLY when a fresh bounded recheck still sees the
 * exact clean revision vector the request admitted.
 */
async function finalizePublication<Lifecycle>(
  ctx: MutationCtx,
  config: RangeSnapshotKindConfig<Lifecycle>,
  row: Doc<"reportRangeResult">,
  fence: number,
  now: number,
  completionPatch: Partial<Doc<"reportRangeResult">> | undefined,
): Promise<RangeSnapshotBatchIntent> {
  const recheck = await readRangeRevisionVector(
    ctx,
    row.storeId,
    row.startDate,
    row.endDate,
    config.maxRangeDays,
  );
  if (
    !recheck.ready ||
    !sameRevisionVector(
      recheck.revisionVector,
      row.movementRevisionVector ?? [],
    )
  ) {
    return terminalSourceStale(ctx, config, row, now);
  }

  await ctx.db.patch("reportRangeResult", row._id, {
    status: "completed",
    movementPhase: "completed",
    movementFence: fence,
    movementEligibleAt: undefined,
    movementSourceDayCursor: undefined,
    computedAt: now,
    ...(completionPatch ?? {}),
  });
  return { next: "done" };
}

/**
 * One atomic unit of snapshot work. Unexpected defects are deliberately NOT
 * caught here: Convex rolls the whole batch back (aggregates, cursor, fence
 * together) and the worker action records retry metadata in a SEPARATE
 * mutation. Everything returned is scheduling intent only.
 */
export async function runRangeSnapshotBatchCore<Lifecycle>(
  ctx: MutationCtx,
  config: RangeSnapshotKindConfig<Lifecycle>,
  args: RangeSnapshotBatchArgs,
): Promise<RangeSnapshotBatchIntent> {
  const now = args.now ?? Date.now();
  const row = await ctx.db.get("reportRangeResult", args.rangeResultId);
  if (
    !row ||
    row.kind !== config.kind ||
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
      const deleted = await config.children.deleteStaleBatch(
        ctx,
        row,
        config.constants.resetChildBatch,
      );
      const phase =
        deleted === config.constants.resetChildBatch
          ? ("queued" as const)
          : ("aggregating" as const);
      await ctx.db.patch("reportRangeResult", row._id, {
        movementPhase: phase,
        movementFence: fence,
        movementEligibleAt: now + config.constants.stallRecoveryMs,
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
          `${config.kind} request ${row._id} has an inconsistent source cursor`,
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
      if (dirty) return terminalSourceStale(ctx, config, row, now);

      const day = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", row.storeId).eq("operatingDate", operatingDate),
        )
        .unique();
      const admissible = admissibleMovementDayRevision(operatingDate, day);
      if (admissible === null || admissible.revision !== expected.revision) {
        return terminalSourceStale(ctx, config, row, now);
      }

      if (expected.revision !== REPORT_MOVEMENT_EMPTY_DAY_REVISION) {
        const outcome = await config.aggregateSourceDay(ctx, row, expected);
        if (outcome === "source_stale") {
          return terminalSourceStale(ctx, config, row, now);
        }
      }

      const nextEntry = vector[dayIndex + 1];
      if (nextEntry) {
        await ctx.db.patch("reportRangeResult", row._id, {
          movementPhase: "aggregating",
          movementFence: fence,
          movementEligibleAt: now + config.constants.stallRecoveryMs,
          movementSourceDayCursor: nextEntry.operatingDate,
        });
        return { next: "continue", phase: "aggregating", fence };
      }

      if (config.hasRankingPhase) {
        await ctx.db.patch("reportRangeResult", row._id, {
          movementPhase: "ranking",
          movementFence: fence,
          movementEligibleAt: now + config.constants.stallRecoveryMs,
          movementSourceDayCursor: undefined,
          ...(config.onEnterRanking?.(row) ?? {}),
        });
        return { next: "continue", phase: "ranking", fence };
      }

      // No ranking phase: the last aggregation batch publishes directly
      // (aggregating → completed), running the same clean-vector recheck the
      // ranking finalization would have run. Re-read the header first: a
      // no-ranking kind accumulates its totals header-side inside
      // `aggregateSourceDay`, and `completionPatch` must see the state that
      // final day just wrote (same transaction, so the read is current).
      const settled = (await ctx.db.get("reportRangeResult", row._id))!;
      return finalizePublication(
        ctx,
        config,
        settled,
        fence,
        now,
        config.completionPatch?.(settled),
      );
    }

    case "ranking": {
      if (!config.hasRankingPhase || !config.runRankingBatch) {
        // A kind without a ranking phase can never legitimately be here.
        return { next: "stale" };
      }
      const outcome = await config.runRankingBatch(ctx, row);
      if (!outcome.done) {
        await ctx.db.patch("reportRangeResult", row._id, {
          movementFence: fence,
          movementEligibleAt: now + config.constants.stallRecoveryMs,
          ...(outcome.headerPatch ?? {}),
        });
        return { next: "continue", phase: "ranking", fence };
      }
      return finalizePublication(
        ctx,
        config,
        row,
        fence,
        now,
        outcome.completionPatch,
      );
    }

    case "retry_wait": {
      // Resume lane. The failed batch rolled back atomically, so durable
      // state tells us where to re-enter:
      //   cursor unset            → ranking (resumes off its own durable
      //     progress) for kinds with a ranking phase;
      //   cursor at startDate AND children exist → a superseded attempt's
      //     children still need the queued reset before re-aggregation;
      //   otherwise               → aggregating at the cursor.
      let phase: RangeSnapshotPhase;
      if (row.movementSourceDayCursor === undefined) {
        if (!config.hasRankingPhase) {
          // A no-ranking kind clears its cursor only at completion, which is
          // not an active phase; an active cursorless row is inconsistent.
          throw new Error(
            `${config.kind} request ${row._id} has an inconsistent source cursor`,
          );
        }
        phase = "ranking";
      } else if (row.movementSourceDayCursor === row.startDate) {
        const anyChild = await config.children.hasAny(ctx, row);
        phase = anyChild ? "queued" : "aggregating";
      } else {
        phase = "aggregating";
      }
      await ctx.db.patch("reportRangeResult", row._id, {
        movementPhase: phase,
        movementFence: fence,
        movementEligibleAt: now + config.constants.stallRecoveryMs,
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

// ---------------------------------------------------------------------------
// Failure lane — the SEPARATE transaction that records retry/backoff or the
// sanitized terminal state after Convex rolled the failed batch back.
// ---------------------------------------------------------------------------

export function rangeSnapshotRetryBackoffMs(
  constants: { retryBaseMs: number; retryMaxMs: number },
  attempt: number,
): number {
  return Math.min(
    constants.retryMaxMs,
    constants.retryBaseMs * 2 ** Math.max(0, attempt - 1),
  );
}

export async function recordRangeSnapshotWorkerFailureCore<Lifecycle>(
  ctx: MutationCtx,
  config: RangeSnapshotKindConfig<Lifecycle>,
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
    row.kind !== config.kind ||
    row.movementFence !== args.expectedFence ||
    !ACTIVE_RANGE_SNAPSHOT_PHASES.includes(row.movementPhase ?? "completed")
  ) {
    // Another worker progressed (or the row is settled) — the failure being
    // reported belongs to a superseded attempt.
    return { recorded: false };
  }

  const attempt = (row.movementAttempt ?? 0) + 1;
  const fence = args.expectedFence + 1;

  if (attempt >= config.constants.maxAttempts) {
    const correlationId = opaqueCorrelationId(String(row._id));
    await ctx.db.patch("reportRangeResult", row._id, {
      status: "failed",
      movementPhase: "terminal_error",
      movementAttempt: attempt,
      movementFence: fence,
      movementErrorCode: config.errorCodes.workerFailed,
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
    movementEligibleAt: now + rangeSnapshotRetryBackoffMs(
      config.constants,
      attempt,
    ),
  });
  return { recorded: true };
}

// ---------------------------------------------------------------------------
// Sweeper hooks — invoked UNCONDITIONALLY from sweepWithCtx (never gated on
// touchedStores). Scheduling and deletion only; no aggregation happens here.
// ---------------------------------------------------------------------------

/** Any-lifecycle config list, as the sweeper carries it. */
export type AnyRangeSnapshotKindConfig = RangeSnapshotKindConfig<unknown>;

function configForKind(
  configs: readonly AnyRangeSnapshotKindConfig[],
  kind: Doc<"reportRangeResult">["kind"],
): AnyRangeSnapshotKindConfig | undefined {
  return configs.find((config) => config.kind === kind);
}

/**
 * The cron backstop: schedule workers for kinded rows whose eligibility time
 * has passed. Budgeted per tick over the shared `by_movementEligibleAt`
 * index, dispatching each row to its kind's worker. Each scheduled row's
 * eligibility is pushed one stall window out so a poison row cannot
 * monopolize every tick — capped attempts move it to terminal instead. A row
 * whose kind has no registered config is settled/foreign and simply leaves
 * the eligible index; an unknown kind can never be scheduled into any
 * lifecycle, legacy or otherwise.
 */
export async function scheduleEligibleRangeSnapshotWork(
  ctx: MutationCtx,
  now: number,
  configs: readonly AnyRangeSnapshotKindConfig[],
): Promise<number> {
  const eligible = await ctx.db
    .query("reportRangeResult")
    .withIndex("by_movementEligibleAt", (q) =>
      q.gte("movementEligibleAt", 1).lte("movementEligibleAt", now),
    )
    .take(RANGE_SNAPSHOT_BACKSTOP_SCHEDULES_PER_TICK);

  let scheduled = 0;
  for (const row of eligible) {
    const config = configForKind(configs, row.kind);
    if (
      !config ||
      row.movementPhase === undefined ||
      !ACTIVE_RANGE_SNAPSHOT_PHASES.includes(row.movementPhase)
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
      movementEligibleAt: now + config.constants.stallRecoveryMs,
    });
    await ctx.scheduler.runAfter(0, config.workerRef, {
      rangeResultId: row._id,
      expectedPhase: row.movementPhase,
      expectedFence: row.movementFence ?? 0,
    });
    scheduled += 1;
  }
  return scheduled;
}

export type RangeSnapshotCleanupResult = {
  childrenDeleted: number;
  headersDeleted: number;
  headersCleaning: number;
};

/**
 * Child-first cleanup of expired kinded snapshots. Children carry their own
 * `expiresAt`, so each kind deletes them directly through its child-table
 * `by_expiresAt` index without loading headers; a header is deleted only
 * once none of its children remain, passing through the explicit `cleaning`
 * phase while they drain. Headers whose kind has no registered config are
 * left alone — legacy (kindless) expiry belongs to the sweeper's own loop,
 * and an unknown kind must never be deleted by machinery that cannot see its
 * children.
 */
export async function cleanupExpiredRangeSnapshots(
  ctx: MutationCtx,
  now: number,
  configs: readonly AnyRangeSnapshotKindConfig[],
): Promise<RangeSnapshotCleanupResult> {
  const result: RangeSnapshotCleanupResult = {
    childrenDeleted: 0,
    headersDeleted: 0,
    headersCleaning: 0,
  };

  for (const config of configs) {
    result.childrenDeleted += await config.children.deleteExpiredBatch(
      ctx,
      now,
      config.constants.cleanupChildBatch,
    );
  }

  const expiredHeaders = await ctx.db
    .query("reportRangeResult")
    .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
    .take(RANGE_SNAPSHOT_CLEANUP_HEADER_BATCH);
  for (const header of expiredHeaders) {
    const config = configForKind(configs, header.kind);
    if (!config) continue; // legacy expiry owns kindless rows
    const remaining = await config.children.hasAny(ctx, header);
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
// Reader guard shared by each kind's public queries.
// ---------------------------------------------------------------------------

export function readableRangeSnapshotHeader<Lifecycle>(
  config: RangeSnapshotKindConfig<Lifecycle>,
  row: Doc<"reportRangeResult"> | null,
  now: number,
): Doc<"reportRangeResult"> | null {
  if (!row || row.kind !== config.kind) return null;
  if (row.expiresAt <= now || row.movementPhase === "cleaning") return null;
  return row;
}
