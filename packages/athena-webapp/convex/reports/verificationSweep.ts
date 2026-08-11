import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { deriveScheduledRunOutcome } from "../automation/scheduledRunLedger";
import { emitNotificationWithCtx } from "../notifications/emit";
import { addDaysToOperatingDate } from "../operations/dailyOperationsAutomation";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import { parseStoreAllowlist, readStoreAllowlist } from "./sweeper";
import {
  classifyDayResult,
  classifyWeekResult,
  initialStreakState,
  nextStreakState,
  type ClassifiedDifference,
  type ExplainedDifference,
  type VerificationClassification,
  type VerificationOutcome,
  type VerificationStreakState,
} from "./verificationClassify";
import {
  verifyCurrentWeekWithCtx,
  verifyDayWithCtx,
  type VerifyCurrentWeekResult,
  type VerifyDayResult,
} from "./verify";

/**
 * The verification sweep orchestrator (plan U3).
 *
 * The scheduled entry point of the report verification family: page the
 * allowlisted stores, select stale-verified settled days plus the current
 * week, run `verify.ts` per subject through BOUNDED internal queries, classify
 * (pure, in the action), upsert `reportVerificationRun` rows via
 * `nextStreakState`, and escalate a wedged per-store runner once per streak.
 *
 * Shape follows `operations/owedDailyCloseSweep.ts`: an internalAction that
 * derives its work set fresh every tick (never stored — the run table plus
 * `certifiedFoldRevision` ARE the cursor, so a crashed tick leaves the same
 * work selected for the next one: declarative liveness, nothing to wedge) and
 * contains each subject so one failure records `error` without killing the
 * tick. Store gating copies `reports/sweeper.ts`: the fail-closed
 * `REPORTS_SWEEP_STORE_ALLOWLIST` env allowlist and the mid-reseed guard.
 *
 * Everything here is internal — no public function, so no operationAdmission.
 * Repo read rules hold throughout: no `.collect()`, no `.paginate()`, every
 * read a bounded `.take()` or an indexed point lookup.
 */

// ---------------------------------------------------------------------------
// Budgets — sizing arithmetic recorded beside each constant (2026-08-03
// learning). Cadence assumption: HOURLY-class tick (registered in U4).
// ---------------------------------------------------------------------------

/**
 * Stores verified per tick. Production today folds a handful of allowlisted
 * stores (single-digit); 8 covers the fleet in one tick with headroom, and a
 * larger fleet simply drains alphabetically across ticks (selection re-derives,
 * nothing is lost).
 */
export const VERIFICATION_STORES_PER_TICK = 8;

/**
 * Trailing operating dates examined per store. 14 = a fortnight: covers a
 * long weekend + holiday backlog (the owed-close sweep uses 7 for closes; a
 * verifier reads further back because refolds/repairs land on older days).
 * Selection cost per store ≈ 14 day-doc reads + 14 dirty-mark point lookups +
 * 14 run-row point lookups ≈ 42 indexed point reads — trivial for one query.
 */
export const VERIFICATION_DAY_LOOKBACK = 14;

/**
 * Day subjects verified per store per tick. One day verification is the heavy
 * unit: up to ~6 domain scans × VERIFY_MAX_DOCS_PER_DOMAIN (500) headers plus
 * per-doc line reads — call it low-thousands of reads per subject, each in its
 * OWN query execution (so per-execution ceilings apply per subject, never to
 * the tick). 4 × 8 stores = ≤ 32 day verifications/tick; at an hourly cadence
 * that re-verifies a busy store's entire 14-day window in ≤ 4 ticks.
 */
export const VERIFICATION_DAYS_PER_STORE = 4;

/**
 * Missing-day probe depth: how many dates immediately BEFORE the newest
 * folded day are checked for the "never folded" discrepancy class when no
 * `reportDay` row exists. Deliberately shallower than the full lookback: a
 * silent day adjacent to activity is suspicious, while deep quiet history is
 * almost always pre-onboarding and would burn the whole day budget recording
 * clean rows for empty dates. 2 dates ≈ one weekend hole.
 */
export const VERIFICATION_MISSING_DAY_LOOKBACK = 2;

/**
 * Age-based re-verify lane width M: the most recent M settled days re-verified
 * regardless of revision on a re-verify tick, bounding detection latency for
 * post-fold source drift (writes that land without a dirty mark) to
 * VERIFICATION_REVERIFY_EVERY_HOURS. 3 days × 1 lane-run/day fits inside the
 * 4-per-store budget alongside ordinary revision-driven work.
 */
export const VERIFICATION_REVERIFY_RECENT_DAYS = 3;

/**
 * Re-verify lane cadence K, in hourly ticks: the lane runs on ticks whose UTC
 * hour index is ≡ 0 (mod 24) — i.e. once per UTC day, deterministically, with
 * no stored counter (see `isReverifyTick`). 24 hourly ticks/day × 3 extra
 * subjects = 3 extra day verifications per store per day.
 */
export const VERIFICATION_REVERIFY_EVERY_HOURS = 24;

/**
 * Consecutive incomplete ticks before a store's runner escalates to an
 * operational event. At an hourly cadence 3 ≈ three hours wedged: transient
 * load blips clear in one tick, while a real wedge (byte-ceiling breach,
 * poisoned subject) surfaces the same morning it starts.
 */
export const VERIFICATION_WEDGE_THRESHOLD = 3;

/**
 * Scheduled-run ledger family for this sweep. Must match the key registered in
 * `SCHEDULED_CRON_INTERVAL_MINUTES` (and its evidence-args literal), whose
 * interval must in turn match the prod cadence in `crons.ts` — the run-key
 * window is derived from that interval.
 */
const VERIFICATION_CRON_FAMILY = "report-verification-sweep" as const;

/**
 * Facts scanned per day when sourcing void magnitudes for the classifier's
 * void-convention attribution. Equal to the fold's MAX_FACTS_PER_DAY (2000;
 * busiest observed day is 93): any day the fold accepted fits, and a day over
 * the cap supplies NO attribution rather than a truncated (wrong) one.
 */
export const VERIFICATION_VOID_FACT_SCAN = 2000;

/**
 * Email gate env — the R8 record-only rollout switch, in the sweeper's
 * fail-closed allowlist idiom: comma-separated store ids; empty or unset
 * emails NOBODY. Enabling email is a config change, never a deploy.
 */
export const REPORTS_VERIFICATION_ALERT_EMAILS_ENV =
  "REPORTS_VERIFICATION_ALERT_EMAILS";

export function isVerificationAlertEmailEnabled(storeId: string): boolean {
  return parseStoreAllowlist(
    process.env[REPORTS_VERIFICATION_ALERT_EMAILS_ENV],
  ).has(storeId);
}

/**
 * Deterministic re-verify lane gate: true on ticks falling in the first UTC
 * hour of the day (hour index mod VERIFICATION_REVERIFY_EVERY_HOURS === 0).
 * Chosen over a stored tick counter because it needs no state, survives
 * restarts/skipped ticks, and lands in the quietest trading hour for the
 * fleet's (GMT) timezone.
 */
export function isReverifyTick(now: number): boolean {
  return (
    Math.floor(now / (60 * 60 * 1000)) % VERIFICATION_REVERIFY_EVERY_HOURS === 0
  );
}

const VERIFICATION_WEDGE_EVENT_TYPE = "reports.verification_wedged";

/**
 * Sentinel subjectKey for the per-store runner-health row (wedge counter,
 * plan R7). Stored in `reportVerificationRun` itself under subjectKind
 * "week" — real week keys are cycle-start dates (`YYYY-MM-DD`), so this key
 * can never collide with one, and reusing the run table keeps runner state in
 * the same single-writer table as every other verification outcome instead of
 * inventing a second store. `streakCount` counts consecutive incomplete
 * ticks; `lastAlertedFingerprint` carries the once-per-streak escalation
 * marker; `reArmEpoch` distinguishes streaks in the operational-event dedupe.
 */
export const VERIFICATION_RUNNER_HEALTH_KEY = "__runner_health__";

/** Escalation marker stored on the runner-health row while a streak has
 * already been escalated; cleared (re-armed) by the next complete tick. */
const WEDGE_ALERTED_MARKER = "wedged";

// ---------------------------------------------------------------------------
// Validators shared by the record mutation
// ---------------------------------------------------------------------------

const differenceSummaryValidator = v.object({
  field: v.string(),
  expectedMinor: v.optional(v.number()),
  actualMinor: v.optional(v.number()),
  classification: v.string(),
});

const outcomeValidator = v.union(
  v.literal("clean"),
  v.literal("partial"),
  v.literal("mismatch"),
  v.literal("truncated"),
  v.literal("unavailable"),
  v.literal("error"),
);

type DifferenceSummary = {
  field: string;
  expectedMinor?: number;
  actualMinor?: number;
  classification: string;
};

function toSummary(
  difference: ClassifiedDifference,
  classification: string,
): DifferenceSummary {
  return {
    field: difference.field,
    ...(typeof difference.expected === "number"
      ? { expectedMinor: difference.expected }
      : {}),
    ...(typeof difference.actual === "number"
      ? { actualMinor: difference.actual }
      : {}),
    classification,
  };
}

function summarizeClassification(classification: VerificationClassification): {
  explained: DifferenceSummary[];
  unexplained: DifferenceSummary[];
} {
  return {
    explained: classification.explained.map((difference: ExplainedDifference) =>
      toSummary(difference, difference.reason),
    ),
    unexplained: classification.unexplained.map((difference) =>
      toSummary(difference, "unexplained"),
    ),
  };
}

// ---------------------------------------------------------------------------
// Store candidates
// ---------------------------------------------------------------------------

type StoreCandidate = {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
};

export const listVerificationStoreCandidates = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    candidates: StoreCandidate[];
    storesSkippedReseeding: number;
  }> => {
    // The allowlist IS the universe: a store outside it is never read at all
    // (the ticket's "distinct handling without source reads" — absence of any
    // row for it is the record). Sorted for a deterministic paging order.
    const allowed = [...readStoreAllowlist()].sort();
    const candidates: StoreCandidate[] = [];
    let storesSkippedReseeding = 0;

    for (const raw of allowed.slice(0, VERIFICATION_STORES_PER_TICK)) {
      const store = await ctx.db.get("store", raw as Id<"store">);
      if (!store) continue;
      // Reseed guard (sweeper idiom): a mid-reseed store's derived rows are
      // mid-rewrite; verifying them would report transient nonsense.
      if (store.reportingReseedStartedAt !== undefined) {
        storesSkippedReseeding += 1;
        continue;
      }
      candidates.push({
        storeId: store._id,
        ...(store.organizationId
          ? { organizationId: store.organizationId }
          : {}),
      });
    }

    return { candidates, storesSkippedReseeding };
  },
});

// ---------------------------------------------------------------------------
// Day selection
// ---------------------------------------------------------------------------

async function loadRunRow(
  ctx: QueryCtx,
  storeId: Id<"store">,
  subjectKind: "day" | "week",
  subjectKey: string,
): Promise<Doc<"reportVerificationRun"> | null> {
  return ctx.db
    .query("reportVerificationRun")
    .withIndex("by_store_subject", (q) =>
      q
        .eq("storeId", storeId)
        .eq("subjectKind", subjectKind)
        .eq("subjectKey", subjectKey),
    )
    .unique();
}

async function hasPendingDirtyMark(
  ctx: QueryCtx,
  storeId: Id<"store">,
  operatingDate: string,
): Promise<boolean> {
  const mark = await ctx.db
    .query("reportDirtyDay")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .unique();
  return mark !== null;
}

export const selectVerificationDaySubjects = internalQuery({
  args: {
    storeId: v.id("store"),
    reVerify: v.boolean(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ dates: string[]; deferred: number }> => {
    // Newest-first window of folded days. The newest date anchors the
    // calendar; a store with no reportDay rows has no day work (nothing folds
    // there yet, so there is no fold output to contradict).
    const days = await ctx.db
      .query("reportDay")
      .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .take(VERIFICATION_DAY_LOOKBACK);
    if (days.length === 0) return { dates: [], deferred: 0 };

    const dayByDate = new Map(days.map((day) => [day.operatingDate, day]));
    const anchor = days[0]!.operatingDate;

    // Candidate dates, newest first: every folded date in the window, plus
    // the shallow missing-day probe immediately behind the anchor (the
    // "missing" discrepancy class — see VERIFICATION_MISSING_DAY_LOOKBACK).
    const candidateDates: string[] = [...dayByDate.keys()];
    for (
      let offset = 1;
      offset <= VERIFICATION_MISSING_DAY_LOOKBACK;
      offset += 1
    ) {
      const date = addDaysToOperatingDate(anchor, -offset);
      if (!dayByDate.has(date)) candidateDates.push(date);
    }
    candidateDates.sort().reverse();

    const selected: string[] = [];
    let deferred = 0;
    // Settled existing days seen so far, newest first — the re-verify lane's
    // candidate pool.
    let settledSeen = 0;

    for (const date of candidateDates) {
      if (selected.length >= VERIFICATION_DAYS_PER_STORE) break;
      const day = dayByDate.get(date);

      // A day still in progress is not settled; skip without deferring.
      if (day?.status === "open") continue;

      // Pending dirty mark: the fold has not caught up — verifying now would
      // contradict output the pipeline already knows is stale. Defer.
      if (await hasPendingDirtyMark(ctx, args.storeId, date)) {
        deferred += 1;
        continue;
      }

      const isSettledExisting = day !== undefined;
      if (isSettledExisting) settledSeen += 1;

      const run = await loadRunRow(ctx, args.storeId, "day", date);

      let stale: boolean;
      if (day?.certifiedFoldRevision !== undefined) {
        // Revision-driven selection: verify when the fold has produced output
        // newer than the last verified generation. An `error` run row is
        // always stale — the subject was never actually verified.
        stale =
          run === null ||
          run.outcome === "error" ||
          run.verifiedCertifiedFoldRevision === undefined ||
          run.verifiedCertifiedFoldRevision < day.certifiedFoldRevision;
      } else {
        // Legacy (pre-stamping) fold or missing day: no revision to advance,
        // so verify exactly once; a later-stamped revision re-selects above.
        stale = run === null || run.outcome === "error";
      }

      // Age-based re-verify lane: on a re-verify tick, the most recent M
      // settled folded days re-verify regardless of revision (post-fold
      // source-drift detection — see the constant's doc).
      const laneSelect =
        args.reVerify &&
        isSettledExisting &&
        settledSeen <= VERIFICATION_REVERIFY_RECENT_DAYS;

      if (stale || laneSelect) selected.push(date);
    }

    return { dates: selected, deferred };
  },
});

// ---------------------------------------------------------------------------
// Per-subject verification reads (each its own bounded query execution)
// ---------------------------------------------------------------------------

export type DaySubjectGathering = {
  result: VerifyDayResult;
  /** Positive magnitudes of the day's voided revenue/units, or null when the
   * fact scan capped out (no attribution beats a truncated one). */
  voidImpact: { revenueMinor: number; units: number } | null;
  dayFlags: {
    hasQuarantinedFacts: boolean;
    hasForeignCurrencyFacts: boolean;
  } | null;
  certifiedFoldRevision: number | null;
};

export const gatherDaySubject = internalQuery({
  args: {
    storeId: v.id("store"),
    operatingDate: v.string(),
  },
  handler: async (ctx, args): Promise<DaySubjectGathering> => {
    const day = await ctx.db
      .query("reportDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", args.storeId).eq("operatingDate", args.operatingDate),
      )
      .unique();

    // Void magnitudes for the classifier's exact-delta attribution, sourced
    // from the day's OWN facts (`factKind: "void"`, emitter-signed): the same
    // rows the fold added are the only defensible basis for explaining the
    // fold-vs-verifier sign disagreement. One past the cap so truncation is
    // detectable; a capped day supplies no attribution.
    const facts = await ctx.db
      .query("reportFact")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", args.storeId).eq("operatingDate", args.operatingDate),
      )
      .take(VERIFICATION_VOID_FACT_SCAN + 1);

    let voidImpact: DaySubjectGathering["voidImpact"];
    if (facts.length > VERIFICATION_VOID_FACT_SCAN) {
      voidImpact = null;
    } else {
      let revenueMinor = 0;
      let units = 0;
      for (const fact of facts) {
        if (fact.factKind !== "void") continue;
        revenueMinor += Math.abs(fact.grossAmountMinor);
        units += Math.abs(fact.quantity);
      }
      voidImpact = { revenueMinor, units };
    }

    const result = await verifyDayWithCtx(
      ctx,
      args.storeId,
      args.operatingDate,
    );

    return {
      result,
      voidImpact,
      dayFlags: day
        ? {
            hasQuarantinedFacts: day.flags.quarantinedFactCount > 0,
            hasForeignCurrencyFacts: day.flags.mixedCurrency,
          }
        : null,
      certifiedFoldRevision: day?.certifiedFoldRevision ?? null,
    };
  },
});

/**
 * A `dayStatus: "missing"` day with ZERO recomputed activity is a quiet
 * missing day, not a discrepancy: there is no projection whose payment
 * posture could be wrong, so the posture comparison against the no-document
 * defaults (`unsettled null` / `coverage unknown`) is vacuous and would page
 * on every never-folded quiet date. The "missing" discrepancy class this
 * sweep exists for is real source activity with no fold — that still
 * surfaces, because a non-zero expected metric produces metric differences
 * which this helper leaves untouched.
 */
export function normalizeMissingDayResult(
  result: VerifyDayResult,
): VerifyDayResult {
  if (result.dayStatus !== "missing") return result;
  if (result.differences.length > 0) return result;
  const hasExpectedActivity = Object.values(result.expected).some(
    (value) => value !== 0,
  );
  if (hasExpectedActivity) return result;
  return {
    ...result,
    paymentDifferences: [],
    matches: !result.truncated,
  };
}

export const selectWeeklySubject = internalQuery({
  args: { storeId: v.id("store") },
  handler: async (
    ctx,
    args,
  ): Promise<{ subjectKey: string; materializedAt: number } | null> => {
    const current = await ctx.db
      .query("reportWeekCurrent")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .unique();
    if (!current) return null;

    const subjectKey =
      "cycleStartDate" in current ? current.cycleStartDate : "current";

    // Staleness gate: run only when materializedAt has advanced past the
    // value recorded on the store's weekly run row. Ungated, the weekly path
    // re-runs up to a week of day-weight source scans per store per tick.
    const run = await loadRunRow(ctx, args.storeId, "week", subjectKey);
    if (
      run !== null &&
      run.outcome !== "error" &&
      run.verifiedCertifiedFoldRevision !== undefined &&
      run.verifiedCertifiedFoldRevision >= current.materializedAt
    ) {
      return null;
    }

    return { subjectKey, materializedAt: current.materializedAt };
  },
});

export const verifyWeekSubject = internalQuery({
  args: { storeId: v.id("store") },
  handler: async (ctx, args): Promise<VerifyCurrentWeekResult> =>
    verifyCurrentWeekWithCtx(ctx, args.storeId),
});

// ---------------------------------------------------------------------------
// Run-row upsert + alert seam
// ---------------------------------------------------------------------------

/**
 * U5 SEAM — verification alert emission.
 *
 * When a subject transitions to alertable (`shouldAlert` from
 * `nextStreakState`) this is the single place an email intent is emitted
 * from, inside the same transaction as the run-row upsert: an intent can
 * never exist for a transition the row did not record, and a rolled-back
 * upsert takes its intent with it.
 *
 * The gate is FAIL-CLOSED (R8 record-only rollout): with the env unset
 * nothing is emitted and the transition is still durably recorded on the run
 * row (`lastAlertedFingerprint` / `reArmEpoch`), so enabling email later is a
 * config change that starts alerting from the next transition — not a replay
 * of the backlog.
 */
export async function maybeEmitVerificationAlert(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    subjectKind: "day" | "week";
    subjectKey: string;
    fingerprint: string;
    reArmEpoch: number;
  },
): Promise<{ wouldEmit: boolean }> {
  const gateEnabled = isVerificationAlertEmailEnabled(String(args.storeId));
  if (!gateEnabled) return { wouldEmit: false };

  await emitNotificationWithCtx(ctx, {
    kind: "reports.verification_discrepancy",
    storeId: args.storeId,
    subjectType: `report_verification_${args.subjectKind}`,
    subjectId: args.subjectKey,
    // Refs only — the email is rebuilt from a fresh read of the run row at
    // send time. The fingerprint and epoch are dedupe components AND the
    // send-time alertability check.
    payload: {
      storeId: args.storeId,
      subjectKind: args.subjectKind,
      subjectKey: args.subjectKey,
      fingerprint: args.fingerprint,
      reArmEpoch: args.reArmEpoch,
    },
  });

  return { wouldEmit: true };
}

function streakStateFromRow(
  row: Doc<"reportVerificationRun"> | null,
): VerificationStreakState {
  if (!row) return initialStreakState();
  return {
    outcome: row.outcome,
    fingerprint: row.unexplainedFingerprint ?? null,
    streakCount: row.streakCount,
    lastAlertedFingerprint: row.lastAlertedFingerprint ?? null,
    reArmEpoch: row.reArmEpoch,
    unexplainedFields: row.unexplainedDifferences.map(
      (difference) => difference.field,
    ),
  };
}

export const recordVerificationOutcome = internalMutation({
  args: {
    storeId: v.id("store"),
    subjectKind: v.union(v.literal("day"), v.literal("week")),
    subjectKey: v.string(),
    outcome: outcomeValidator,
    explained: v.array(differenceSummaryValidator),
    unexplained: v.array(differenceSummaryValidator),
    fingerprint: v.optional(v.string()),
    alertable: v.boolean(),
    checkedFields: v.array(v.string()),
    /** Day rows: the verified `certifiedFoldRevision` (absent for legacy /
     * missing days). Week rows: `reportWeekCurrent.materializedAt` — the
     * weekly staleness revision — stored in the same field by convention. */
    verifiedRevision: v.optional(v.number()),
    now: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ shouldAlert: boolean; wouldEmit: boolean }> => {
    const existing = await loadRunRow(
      ctx,
      args.storeId,
      args.subjectKind,
      args.subjectKey,
    );
    const previous = streakStateFromRow(existing);

    // Rebuild the minimal classification `nextStreakState` consumes; the
    // action already ran the pure classifier, and only the unexplained field
    // list, checked list, fingerprint and alertability drive transitions.
    const classification: VerificationClassification = {
      outcome: args.outcome as VerificationOutcome,
      explained: [],
      unexplained: args.unexplained.map((difference) => ({
        field: difference.field,
        expected: difference.expectedMinor ?? null,
        actual: difference.actualMinor ?? null,
      })),
      fingerprint: args.fingerprint ?? null,
      alertable: args.alertable,
      checkedFields: args.checkedFields,
    };

    const { state, shouldAlert } = nextStreakState(previous, classification);

    const rowDoc = {
      storeId: args.storeId,
      subjectKind: args.subjectKind,
      subjectKey: args.subjectKey,
      outcome: args.outcome,
      explainedDifferences: args.explained,
      unexplainedDifferences: args.unexplained,
      // Persisted for the U5 alert email: its complement within the subject's
      // field inventory is what verification declined to check.
      checkedFields: args.checkedFields,
      // `undefined` on patch is an explicit erase — a cleared streak must not
      // keep a stale fingerprint or alert marker.
      unexplainedFingerprint: state.fingerprint ?? undefined,
      streakCount: state.streakCount,
      lastAlertedFingerprint: state.lastAlertedFingerprint ?? undefined,
      reArmEpoch: state.reArmEpoch,
      verifiedCertifiedFoldRevision: args.verifiedRevision,
      verifiedAt: args.now,
      updatedAt: args.now,
    };

    if (existing) {
      await ctx.db.patch("reportVerificationRun", existing._id, rowDoc);
    } else {
      await ctx.db.insert("reportVerificationRun", {
        ...rowDoc,
        createdAt: args.now,
      });
    }

    let wouldEmit = false;
    if (shouldAlert && state.fingerprint !== null) {
      ({ wouldEmit } = await maybeEmitVerificationAlert(ctx, {
        storeId: args.storeId,
        subjectKind: args.subjectKind,
        subjectKey: args.subjectKey,
        fingerprint: state.fingerprint,
        reArmEpoch: state.reArmEpoch,
      }));
    }

    return { shouldAlert, wouldEmit };
  },
});

// ---------------------------------------------------------------------------
// Runner liveness (wedge escalation, R7)
// ---------------------------------------------------------------------------

export const recordStoreTickHealth = internalMutation({
  args: {
    storeId: v.id("store"),
    organizationId: v.optional(v.id("organization")),
    incomplete: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<{ escalated: boolean }> => {
    const existing = await loadRunRow(
      ctx,
      args.storeId,
      "week",
      VERIFICATION_RUNNER_HEALTH_KEY,
    );

    const previousStreak = existing?.streakCount ?? 0;
    const previousEpoch = existing?.reArmEpoch ?? 0;
    const alreadyEscalated =
      existing?.lastAlertedFingerprint === WEDGE_ALERTED_MARKER;

    let streakCount: number;
    let reArmEpoch = previousEpoch;
    let marker: string | undefined;
    let escalated = false;

    if (args.incomplete) {
      streakCount = previousStreak + 1;
      marker = alreadyEscalated ? WEDGE_ALERTED_MARKER : undefined;
      if (streakCount >= VERIFICATION_WEDGE_THRESHOLD && !alreadyEscalated) {
        // ONE operational event per streak (owed-close dedupe pattern): the
        // event table dedupes on (store, subject, type, metadata dedupe
        // keys); `escalationEpoch` changes only when a complete tick re-arms,
        // so a stuck store escalates once and a NEW streak escalates again.
        await recordOperationalEventWithCtx(ctx, {
          actorType: "automation",
          eventType: VERIFICATION_WEDGE_EVENT_TYPE,
          message:
            `Report verification for this store has not completed a full ` +
            `sweep tick ${streakCount} times in a row.`,
          metadata: {
            consecutiveIncompleteTicks: streakCount,
            escalationEpoch: previousEpoch,
          },
          metadataDedupeKeys: ["escalationEpoch"],
          reason: "verification_runner_wedged",
          storeId: args.storeId,
          subjectId: String(args.storeId),
          subjectLabel: "Report verification runner",
          subjectType: "report_verification_runner",
          ...(args.organizationId
            ? { organizationId: args.organizationId }
            : {}),
        });
        marker = WEDGE_ALERTED_MARKER;
        escalated = true;
      }
    } else {
      streakCount = 0;
      marker = undefined;
      // Re-arm: a resolved streak bumps the epoch so the NEXT wedge streak
      // produces a fresh (non-deduped) operational event.
      if (previousStreak > 0) reArmEpoch = previousEpoch + 1;
    }

    const rowDoc = {
      storeId: args.storeId,
      subjectKind: "week" as const,
      subjectKey: VERIFICATION_RUNNER_HEALTH_KEY,
      outcome: (args.incomplete ? "error" : "clean") as "error" | "clean",
      explainedDifferences: [],
      unexplainedDifferences: [],
      unexplainedFingerprint: undefined,
      streakCount,
      lastAlertedFingerprint: marker,
      reArmEpoch,
      verifiedCertifiedFoldRevision: undefined,
      verifiedAt: args.now,
      updatedAt: args.now,
    };
    if (existing) {
      await ctx.db.patch("reportVerificationRun", existing._id, rowDoc);
    } else {
      await ctx.db.insert("reportVerificationRun", {
        ...rowDoc,
        createdAt: args.now,
      });
    }

    return { escalated };
  },
});

// ---------------------------------------------------------------------------
// The orchestrator
// ---------------------------------------------------------------------------

/** The action surface the orchestrator needs — narrow so tests can drive it
 * against a convex-test harness (and inject per-subject failures). */
export type VerificationSweepCtx = Pick<ActionCtx, "runQuery" | "runMutation">;

export type VerificationSweepResult = {
  storesScanned: number;
  storesSkippedReseeding: number;
  daysVerified: number;
  daysDeferred: number;
  weeksVerified: number;
  subjectsErrored: number;
  /** Subjects whose run transitioned to alertable this tick (recorded even
   * while the email gate is off — the R8 record-only rollout). */
  alertTransitions: number;
  /** Of those, how many the enabled email gate would have emitted for. */
  emitsWouldFire: number;
  wedgeEscalations: number;
};

async function recordErrorOutcome(
  ctx: VerificationSweepCtx,
  storeId: Id<"store">,
  subjectKind: "day" | "week",
  subjectKey: string,
  now: number,
): Promise<void> {
  await ctx.runMutation(
    internal.reports.verificationSweep.recordVerificationOutcome,
    {
      storeId,
      subjectKind,
      subjectKey,
      outcome: "error",
      explained: [],
      unexplained: [],
      alertable: false,
      checkedFields: [],
      now,
    },
  );
}

export async function runVerificationSweepWithCtx(
  ctx: VerificationSweepCtx,
  args: { now?: number },
): Promise<VerificationSweepResult> {
  const now = args.now ?? Date.now();
  const reVerify = isReverifyTick(now);

  const { candidates, storesSkippedReseeding } = await ctx.runQuery(
    internal.reports.verificationSweep.listVerificationStoreCandidates,
    {},
  );

  const result: VerificationSweepResult = {
    storesScanned: candidates.length,
    storesSkippedReseeding,
    daysVerified: 0,
    daysDeferred: 0,
    weeksVerified: 0,
    subjectsErrored: 0,
    alertTransitions: 0,
    emitsWouldFire: 0,
    wedgeEscalations: 0,
  };

  for (const candidate of candidates) {
    // Per-store completeness for the wedge counter: a tick is complete for a
    // store when selection succeeded and no subject recorded `error`.
    let storeIncomplete = false;

    // Per-store ledger counters (snapshot of this store's slice of the tick).
    const storeCounts = {
      daysVerified: 0,
      daysDeferred: 0,
      weeksVerified: 0,
      subjectsErrored: 0,
      alertTransitions: 0,
      emitsWouldFire: 0,
    };

    // --- Day lane ----------------------------------------------------------
    let dates: string[] = [];
    try {
      const selection = await ctx.runQuery(
        internal.reports.verificationSweep.selectVerificationDaySubjects,
        { storeId: candidate.storeId, reVerify },
      );
      dates = selection.dates;
      result.daysDeferred += selection.deferred;
      storeCounts.daysDeferred += selection.deferred;
    } catch {
      storeIncomplete = true;
    }

    for (const operatingDate of dates) {
      try {
        const gathering = await ctx.runQuery(
          internal.reports.verificationSweep.gatherDaySubject,
          { storeId: candidate.storeId, operatingDate },
        );
        const classification = classifyDayResult(
          normalizeMissingDayResult(gathering.result),
          {
            ...(gathering.voidImpact
              ? { voidImpact: gathering.voidImpact }
              : {}),
            ...(gathering.dayFlags ? { dayFlags: gathering.dayFlags } : {}),
          },
        );
        const { explained, unexplained } =
          summarizeClassification(classification);
        const recorded = await ctx.runMutation(
          internal.reports.verificationSweep.recordVerificationOutcome,
          {
            storeId: candidate.storeId,
            subjectKind: "day",
            subjectKey: operatingDate,
            outcome: classification.outcome,
            explained,
            unexplained,
            ...(classification.fingerprint !== null
              ? { fingerprint: classification.fingerprint }
              : {}),
            alertable: classification.alertable,
            checkedFields: classification.checkedFields,
            ...(gathering.certifiedFoldRevision !== null
              ? { verifiedRevision: gathering.certifiedFoldRevision }
              : {}),
            now,
          },
        );
        result.daysVerified += 1;
        storeCounts.daysVerified += 1;
        if (recorded.shouldAlert) {
          result.alertTransitions += 1;
          storeCounts.alertTransitions += 1;
        }
        if (recorded.wouldEmit) {
          result.emitsWouldFire += 1;
          storeCounts.emitsWouldFire += 1;
        }
      } catch {
        // Containment: one subject's failure records `error` and the tick
        // moves on. The error row keeps the subject selected next tick.
        result.subjectsErrored += 1;
        storeCounts.subjectsErrored += 1;
        storeIncomplete = true;
        try {
          await recordErrorOutcome(
            ctx,
            candidate.storeId,
            "day",
            operatingDate,
            now,
          );
        } catch {
          // Even the error record failed; the wedge counter carries it.
        }
      }
    }

    // --- Weekly lane -------------------------------------------------------
    try {
      const weekly = await ctx.runQuery(
        internal.reports.verificationSweep.selectWeeklySubject,
        { storeId: candidate.storeId },
      );
      if (weekly !== null) {
        try {
          const weekResult = await ctx.runQuery(
            internal.reports.verificationSweep.verifyWeekSubject,
            { storeId: candidate.storeId },
          );
          const classification = classifyWeekResult(weekResult, {
            storeAllowlisted: true,
          });
          const { explained, unexplained } =
            summarizeClassification(classification);
          const recorded = await ctx.runMutation(
            internal.reports.verificationSweep.recordVerificationOutcome,
            {
              storeId: candidate.storeId,
              subjectKind: "week",
              subjectKey: weekly.subjectKey,
              outcome: classification.outcome,
              explained,
              unexplained,
              ...(classification.fingerprint !== null
                ? { fingerprint: classification.fingerprint }
                : {}),
              alertable: classification.alertable,
              checkedFields: classification.checkedFields,
              verifiedRevision: weekly.materializedAt,
              now,
            },
          );
          result.weeksVerified += 1;
          storeCounts.weeksVerified += 1;
          if (recorded.shouldAlert) {
            result.alertTransitions += 1;
            storeCounts.alertTransitions += 1;
          }
          if (recorded.wouldEmit) {
            result.emitsWouldFire += 1;
            storeCounts.emitsWouldFire += 1;
          }
        } catch {
          result.subjectsErrored += 1;
          storeCounts.subjectsErrored += 1;
          storeIncomplete = true;
          try {
            await recordErrorOutcome(
              ctx,
              candidate.storeId,
              "week",
              weekly.subjectKey,
              now,
            );
          } catch {
            // Carried by the wedge counter.
          }
        }
      }
    } catch {
      storeIncomplete = true;
    }

    // --- Runner liveness ---------------------------------------------------
    try {
      const health = await ctx.runMutation(
        internal.reports.verificationSweep.recordStoreTickHealth,
        {
          storeId: candidate.storeId,
          ...(candidate.organizationId
            ? { organizationId: candidate.organizationId }
            : {}),
          incomplete: storeIncomplete,
          now,
        },
      );
      if (health.escalated) result.wedgeEscalations += 1;
    } catch {
      // Health recording itself failing leaves the previous streak in place;
      // the next tick's write catches up.
    }

    // --- Store-scope ledger evidence ---------------------------------------
    // `bestEffortRecordScheduledRunEvidence` takes a MutationCtx and is not
    // reachable from the action ctx, so the swallow lives here instead.
    // Bookkeeping must never fail the sweep's real work.
    const storeSubjects =
      storeCounts.daysVerified +
      storeCounts.weeksVerified +
      storeCounts.subjectsErrored;
    try {
      await ctx.runMutation(
        internal.automation.scheduledRunLedger.recordScheduledRunEvidence,
        {
          cronFamily: VERIFICATION_CRON_FAMILY,
          now,
          scope: "store",
          storeId: candidate.storeId,
          ...(candidate.organizationId
            ? { organizationId: candidate.organizationId }
            : {}),
          outcome: deriveScheduledRunOutcome({
            candidateCount: storeSubjects,
            succeededCount:
              storeCounts.daysVerified + storeCounts.weeksVerified,
            failedCount: storeCounts.subjectsErrored,
          }),
          candidateCount: storeSubjects,
          processedCount: storeSubjects,
          succeededCount: storeCounts.daysVerified + storeCounts.weeksVerified,
          failedCount: storeCounts.subjectsErrored,
          skippedCount: storeCounts.daysDeferred,
          sourceSubjectType: "reportVerificationRun",
          sampleSubjectIds: [candidate.storeId],
          snapshotCounts: { ...storeCounts },
        },
      );
    } catch {
      // Ledger bookkeeping is observational; never fail the tick on it.
    }
  }

  // --- System-scope ledger summary -----------------------------------------
  try {
    await ctx.runMutation(
      internal.automation.scheduledRunLedger.recordScheduledRunEvidence,
      {
        cronFamily: VERIFICATION_CRON_FAMILY,
        now,
        scope: "system",
        visibility: "support",
        outcome: deriveScheduledRunOutcome({
          candidateCount: result.storesScanned,
          succeededCount: result.storesScanned,
          failedCount: 0,
        }),
        candidateCount: result.storesScanned,
        processedCount: result.storesScanned,
        succeededCount: result.storesScanned,
        failedCount: 0,
        skippedCount: result.storesSkippedReseeding,
        sourceSubjectType: "reportVerificationRun",
        sampleSubjectIds: candidates.map((c) => c.storeId).slice(0, 25),
        snapshotCounts: {
          daysVerified: result.daysVerified,
          daysDeferred: result.daysDeferred,
          weeksVerified: result.weeksVerified,
          subjectsErrored: result.subjectsErrored,
          alertTransitions: result.alertTransitions,
          emitsWouldFire: result.emitsWouldFire,
          wedgeEscalations: result.wedgeEscalations,
        },
      },
    );
  } catch {
    // Same containment as the store rows.
  }

  return result;
}

/** The scheduled entry point (registered in crons.ts by U4). */
export const runVerificationSweep = internalAction({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<VerificationSweepResult> =>
    runVerificationSweepWithCtx(ctx, args),
});
