import { v } from "convex/values";

import { normalizeCurrencyCode } from "../../shared/reportsContract";
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
import { resolveOperatingDate } from "./operatingDay";
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
 * stores (single-digit); 8 covers the fleet in one tick with headroom. A
 * larger fleet rotates statelessly: the per-tick window starts at
 * (tick index × this width, mod eligible-store count) and wraps, so a fleet of
 * N eligible stores is fully covered every ceil(N/8) ticks with no stored
 * cursor (see `listVerificationStoreCandidates`, which carries the proof).
 * Reseeding and malformed allowlist entries are filtered out BEFORE the window
 * is cut, so a skipped store never burns one of the 8 slots.
 */
export const VERIFICATION_STORES_PER_TICK = 8;

/**
 * Tick cadence, in minutes, MIRRORING the `report-verification-sweep`
 * registration in `crons.ts`: hourly in prod, every six hours everywhere else.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT `SCHEDULED_CRON_INTERVAL_MINUTES` (B2).
 * The rotation below needs a TICK INDEX that advances by exactly one per
 * actual execution — that is the whole basis of the "stride equals the window
 * width" coverage proof. Deriving it from wall-clock hours makes the stride
 * 1 in prod (windows overlap by 7; full coverage takes N-7 ticks, not
 * ceil(N/8)); deriving it from the ledger's `SCHEDULED_CRON_INTERVAL_MINUTES`
 * (60, the run-key window, which is prod-shaped for both stages) makes the
 * non-prod index jump by 6 per tick, i.e. a stride of 48 mod N — and wherever
 * gcd(48, N) > 8 whole blocks of stores are never selected at all. The index
 * has to come from the REAL cadence of the deployment it runs on, so both
 * numbers live here beside the cron that must agree with them.
 *
 * `crons.test.ts` is the guard that these stay in step with `crons.ts`.
 */
export const VERIFICATION_TICK_MINUTES_PROD = 60;
export const VERIFICATION_TICK_MINUTES_NON_PROD = 6 * 60;

/** Milliseconds between two scheduled ticks on THIS deployment. */
export function verificationTickIntervalMs(): number {
  return (
    (process.env.STAGE === "prod"
      ? VERIFICATION_TICK_MINUTES_PROD
      : VERIFICATION_TICK_MINUTES_NON_PROD) *
    60 *
    1000
  );
}

/**
 * The stateless rotation cursor: a monotonic counter that advances by exactly
 * one per scheduled tick, derived from the clock and the cadence rather than
 * stored. A crashed tick changes nothing — the next one simply reads the next
 * index.
 */
export function verificationTickIndex(now: number): number {
  return Math.floor(now / verificationTickIntervalMs());
}

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
 * Forward (stall) probe depth: how many of the store's most recent SETTLED
 * operating dates — counted back from yesterday in the store's own timezone,
 * never today (still open) — are probed for a missing `reportDay` row.
 *
 * WHY THIS EXISTS (C3). The backwards probe anchors on the NEWEST folded day,
 * so if folding stops entirely the anchor freezes with it: every tick
 * re-derives the same anchor, re-probes already-folded earlier dates, and
 * reports clean forever. The loudest missing-fold class — "the pipeline
 * stopped" — is invisible to a backwards-only probe. Probing forward from the
 * store's CURRENT operating date makes a stall surface as missing days with
 * real recomputed activity (a quiet stalled store still normalizes to clean,
 * which is the honest reading).
 *
 * 3 dates ≈ a long weekend of stalled folding, and costs at most 3 extra
 * (dirty-mark + run-row) point lookups per store per tick.
 *
 * SCOPE, precisely. The walk stops at the first date `<= anchor`, and the
 * anchor is the newest `reportDay` row of ANY status — including today's open
 * row. So on a store that is still folding at all, the anchor is today (or
 * yesterday), the walk breaks on its first iteration, and the probe costs
 * nothing and finds nothing. It engages only when a store has stopped
 * producing `reportDay` rows ENTIRELY for at least one settled date — a full
 * pipeline stall, not a partial one. A store that keeps writing today's open
 * row while its settled folds go wrong is covered by the ordinary backwards
 * candidates, not by this probe.
 */
export const VERIFICATION_STALL_PROBE_DAYS = 3;

/**
 * Verification slots the forward stall probe may claim per store per tick.
 * ONE: a stall is proven by a single missing recent date (the newest is the
 * most decisive), and the probe must never crowd the real folded days out of
 * the budget.
 *
 * "Slot" is a CAP, not a reservation: the probe date is prepended to the
 * ordinary candidates and the concatenation is then truncated to
 * VERIFICATION_DAYS_PER_STORE, so the probe consumes one of the four ordinary
 * slots. The cap is what matters — with at most 1 stall date and at most
 * VERIFICATION_ERROR_SLOTS_PER_STORE error dates ahead of them, ordinary
 * newest-first work always keeps at least 2 of the 4 slots.
 */
export const VERIFICATION_STALL_PROBE_SLOTS = 1;

/**
 * Day-lane slots reserved for subjects whose last run recorded `error`.
 *
 * WHY (M2). `error` rows are unconditionally stale and candidates are ordered
 * newest-first, so VERIFICATION_DAYS_PER_STORE permanently-failing recent days
 * would pin every slot forever and the rest of the 14-day lookback would never
 * be verified again — head-of-line blocking behind a poisoned subject, while
 * the store still looks "verified" in aggregate. Capping error rows at ONE
 * slot per tick guarantees the other three always advance, and the error
 * candidates are taken OLDEST-`verifiedAt`-first so they rotate through that
 * single slot instead of one row monopolising it.
 *
 * As with the stall probe, this is a CAP rather than reserved capacity: the
 * error date is prepended and the list truncated to
 * VERIFICATION_DAYS_PER_STORE, so it spends one ordinary slot. The guarantee
 * the cap buys is the one that matters — at most 1 error + at most 1 stall
 * date ahead of the ordinary candidates leaves ordinary work >= 2 slots.
 */
export const VERIFICATION_ERROR_SLOTS_PER_STORE = 1;

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
 * Re-escalation ladder for a store that stays wedged, in consecutive
 * incomplete ticks (hourly): first alarm at the threshold (~3h), a second at
 * ~1 day, a third at ~1 week, and weekly thereafter (see
 * `shouldEscalateWedge`).
 *
 * WHY (M1). Escalating exactly once per streak means a permanently wedged
 * store emits ONE operational event and then goes silent forever while still
 * burning a near-limit read every hour — the failure mode that looks most like
 * health. A ladder keeps the signal alive without turning it into an hourly
 * page: at most 2 extra events in the first week, then one a week.
 */
export const VERIFICATION_WEDGE_REALERT_TICKS = [24, 168] as const;

/** Ladder tail: keep re-alerting every this-many ticks (~weekly) after the
 * last rung, so a store wedged for a month is not silent for a month. */
const VERIFICATION_WEDGE_REALERT_PERIOD = 168;

/**
 * Does a wedge streak of exactly this length ring the alarm?
 *
 * Pure and total so the ladder is testable without a database: true on the
 * threshold, on each ladder rung, and then once per
 * VERIFICATION_WEDGE_REALERT_PERIOD ticks beyond the last rung.
 */
export function shouldEscalateWedge(streakCount: number): boolean {
  if (streakCount === VERIFICATION_WEDGE_THRESHOLD) return true;
  if (
    (VERIFICATION_WEDGE_REALERT_TICKS as readonly number[]).includes(
      streakCount,
    )
  )
    return true;
  const last =
    VERIFICATION_WEDGE_REALERT_TICKS[
      VERIFICATION_WEDGE_REALERT_TICKS.length - 1
    ]!;
  return (
    streakCount > last &&
    (streakCount - last) % VERIFICATION_WEDGE_REALERT_PERIOD === 0
  );
}

/**
 * Minimum wall-clock spacing between two weekly verifications of the SAME
 * store, in hours.
 *
 * WHY (H1). The materialization-revision gate alone does not bound weekly
 * cost: `reportWeekCurrent.materializedAt` is stamped `now` on EVERY rebuild,
 * and `rebuildCurrentWeek` runs for every drained `reportDirtyWeek` mark in
 * the 5-minute reports sweep. An actively-trading store therefore
 * re-materializes its week every ~5 minutes, so the revision has ALWAYS
 * advanced by the next hourly tick and the gate suppresses idle stores only —
 * exactly the stores whose weekly verification is cheap. The real bound has to
 * be time-based.
 *
 * 6h = at most 4 weekly verifications per store per day (down from 24), i.e.
 * ≤ 32/day across the 8-store tick budget. Detection latency for a weekly
 * discrepancy is correspondingly ≤ 6h, which is well inside the daily/weekly
 * reporting cadence the week projection feeds.
 */
export const VERIFICATION_WEEK_MIN_INTERVAL_HOURS = 6;

/**
 * Pre-flight ceiling on the allocation rows a single weekly verification may
 * have to read, measured over the union of the seven days' payment windows.
 *
 * WHY (H2). `verifyCurrentWeekWithCtx` loops `computeExpectedDay` over all
 * seven cycle dates inside ONE query execution, and each date re-reads a
 * 90-day `paymentAllocation` reversal-lookback window (≤3,001 docs) plus its
 * in-period allocations (≤5,001). The seven windows overlap almost entirely,
 * so the SAME rows are read seven times, and `computeExpectedDay`'s
 * `truncated` flags are per-domain — they say nothing about the aggregate
 * transaction budget. On breach Convex's per-transaction ceiling (16,384 docs)
 * throws, and the week records `error` (retryable, alarming) rather than the
 * honest `truncated` (could-not-check).
 *
 * SIZING. Let U be the number of allocation rows in the union window. The
 * weekly execution reads ≈ 7·U allocation docs plus the five per-date domain
 * scans (≤501 docs each, ≈2.5k worst case for the whole week in practice).
 * Reserving ~6k docs of headroom for the domain scans, line reads and day/
 * schedule/close probes leaves ~10,000 docs for allocations: U ≤ 10,000/7 ≈
 * 1,428, rounded DOWN to 1,400. Production measurement (2026-08-02, Wigclub:
 * ~12 allocations/day → ~1,080 rows over 90 days) sits ~23% under this cap.
 *
 * Over the cap the weekly lane records `truncated` WITHOUT running the
 * verification — an honest never-alertable could-not-check, instead of a throw
 * mislabelled `error`. See the report note: the real fix is splitting
 * `verifyCurrentWeekWithCtx` into per-date executions inside verify.ts.
 */
export const VERIFICATION_WEEK_ALLOCATION_PROBE = 1_400;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Mirrors verify.ts's PAYMENT_VOID_LOOKBACK_MS / OPERATING_DAY_SLACK_MS: the
 * union window the probe above measures. Declared locally because they are
 * module-private in verify.ts. */
const VERIFICATION_WEEK_PROBE_LOOKBACK_MS = 90 * DAY_MS + 18 * 60 * 60 * 1000;

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
 * restarts, and lands in the quietest trading hour for the fleet's (GMT)
 * timezone.
 *
 * L3 NOTE — this keys off EXECUTION time, so a 00:47Z tick that runs late at
 * 01:03Z returns false and the scheduled lane instant is missed. That is not
 * a silent skip: `selectVerificationDaySubjects` ALSO admits a recent settled
 * day into the lane whenever its run row's own `verifiedAt` is older than
 * VERIFICATION_REVERIFY_EVERY_HOURS, so a missed lane tick is caught up by the
 * very next hourly tick. This function is the schedule; the age check is the
 * guarantee.
 *
 * B3 NOTE — this gate RESONATES with the store rotation, and the age check
 * above is why that is survivable rather than a hole. Re-verify ticks are the
 * tick indices ≡ 0 (mod R) where R is this cadence expressed in ticks (24 in
 * prod, 4 in non-prod), and `listVerificationStoreCandidates` starts its
 * window at (tickIndex × S) mod N for S = VERIFICATION_STORES_PER_TICK. So the
 * window starts seen ON re-verify ticks are the multiples of gcd(R·S, N), and
 * whenever gcd(R·S, N) > S some stores never land on a SCHEDULED re-verify
 * tick at all (prod: N = 16 starves 8 stores, N = 24 starves 16). Those stores
 * are not starved of the LANE, only of its schedule: they are still selected
 * every ceil(N/S) ticks, and `selectVerificationDaySubjects` admits their
 * recent settled days on age alone once the run row passes
 * VERIFICATION_REVERIFY_EVERY_HOURS. Worst-case lane latency for such a store
 * is therefore 24h + ceil(N/S) ticks instead of exactly 24h. Left as a
 * documented skew rather than fixed with a rotation offset, because every
 * offset that breaks the resonance also breaks the exact ceil(N/S) coverage
 * tiling the rotation is built on, and the fleet is single-digit.
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
  args: {
    /** Tick instant — the stateless rotation cursor: the selection window
     * starts at (tick index × window width, mod eligible count), so
     * consecutive ticks TILE the fleet with nothing stored. */
    now: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    candidates: StoreCandidate[];
    storesSkippedReseeding: number;
    /** Allowlist entries that are not valid store ids — raw operator text that
     * does not name a store at all. Skipped, never fatal: one bad entry must
     * not kill the whole tick. */
    storesSkippedMalformed: number;
    /** Allowlist entries that ARE well-formed store ids whose store doc no
     * longer exists — a deleted store still listed in the env. Counted apart
     * from malformed text (B6) because the two want different operator
     * actions: fix the typo, versus prune the allowlist. */
    storesSkippedMissing: number;
  }> => {
    // The allowlist IS the universe: a store outside it is never read at all
    // (the ticket's "distinct handling without source reads" — absence of any
    // row for it is the record). Sorted for a deterministic paging order.
    const allowed = [...readStoreAllowlist()].sort();
    const eligible: StoreCandidate[] = [];
    let storesSkippedReseeding = 0;
    let storesSkippedMalformed = 0;
    let storesSkippedMissing = 0;

    for (const raw of allowed) {
      // The env value is raw operator text: normalize instead of casting, so
      // a malformed entry is a counted skip rather than a thrown read.
      const storeId = ctx.db.normalizeId("store", raw);
      if (storeId === null) {
        storesSkippedMalformed += 1;
        continue;
      }
      const store = await ctx.db.get("store", storeId);
      if (!store) {
        storesSkippedMissing += 1;
        continue;
      }
      // Reseed guard (sweeper idiom): a mid-reseed store's derived rows are
      // mid-rewrite; verifying them would report transient nonsense.
      if (store.reportingReseedStartedAt !== undefined) {
        storesSkippedReseeding += 1;
        continue;
      }
      eligible.push({
        storeId: store._id,
        ...(store.organizationId
          ? { organizationId: store.organizationId }
          : {}),
      });
    }

    // Stateless rotation over the ELIGIBLE list (filtered first, so skips do
    // not burn slots): the window starts at (tickIndex × S) mod N for
    // S = VERIFICATION_STORES_PER_TICK, wraps, and takes min(N, S) entries.
    //
    // THE STRIDE IS THE WINDOW WIDTH (B2), and that is the whole proof. Ticks
    // i = 0 … ceil(N/S) − 1 have starts 0, S, 2S, … , all of them < N (because
    // S·(ceil(N/S) − 1) < N), so they are literal multiples of S rather than
    // wrapped ones, and their windows tile [0, S·ceil(N/S)) ⊇ [0, N). Every
    // eligible store is therefore selected at least once every ceil(N/S)
    // ticks, for EVERY N — nothing is starved, and no cursor is stored (a
    // crashed tick changes nothing; the next tick's window simply starts one
    // full window further on).
    //
    // The stride is what makes the bound true. Advancing by ONE store per
    // tick — the shape this replaced — leaves consecutive windows overlapping
    // by S−1 and full coverage takes max(1, N − S + 1) ticks: at N = 17 that
    // is 10 ticks where the comment promised 3. Multiplying the WALL-CLOCK
    // HOUR by S instead is worse than either: it is correct in prod and
    // silently reintroduces permanent starvation in non-prod, where ticks are
    // six hours apart and the effective stride becomes 6S = 48 mod N (with
    // gcd(48, N) > S, whole blocks are never selected). Hence
    // `verificationTickIndex`, which counts REAL ticks on this deployment.
    const candidates: StoreCandidate[] = [];
    if (eligible.length > 0) {
      const start =
        (verificationTickIndex(args.now) * VERIFICATION_STORES_PER_TICK) %
        eligible.length;
      const count = Math.min(eligible.length, VERIFICATION_STORES_PER_TICK);
      for (let index = 0; index < count; index += 1) {
        candidates.push(eligible[(start + index) % eligible.length]!);
      }
    }

    return {
      candidates,
      storesSkippedReseeding,
      storesSkippedMalformed,
      storesSkippedMissing,
    };
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
    /** Tick instant. Selection needs a clock for two reasons: the forward
     * stall probe (C3) has to know the store's CURRENT operating date, and the
     * re-verify lane's catch-up (L3) compares run-row age against it. */
    now: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    dates: string[];
    /** Dates the fold-drain guard deferred — the fold has not caught up yet,
     * and a later tick picks them up. */
    deferred: number;
  }> => {
    // Newest-first window of folded days. The newest date anchors the
    // calendar; a store with no reportDay rows has no day work (nothing folds
    // there yet, so there is no fold output to contradict).
    const days = await ctx.db
      .query("reportDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", args.storeId),
      )
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

    // FORWARD (stall) probe — C3. Walk back from the store's newest SETTLED
    // operating date (yesterday, store-local) toward the anchor. When folding
    // has stalled these dates have no `reportDay` row at all and become
    // missing-day subjects; when folding is current the loop breaks on its
    // first iteration and costs nothing.
    const currentOperatingDate = await resolveOperatingDate(
      ctx,
      args.storeId,
      args.now,
    );
    const newestSettledDate = addDaysToOperatingDate(currentOperatingDate, -1);
    const stallProbeDates: string[] = [];
    for (let offset = 0; offset < VERIFICATION_STALL_PROBE_DAYS; offset += 1) {
      const date = addDaysToOperatingDate(newestSettledDate, -offset);
      if (date <= anchor) break;
      if (!dayByDate.has(date)) stallProbeDates.push(date);
    }
    candidateDates.push(...stallProbeDates);
    const stallProbeSet = new Set(stallProbeDates);

    candidateDates.sort().reverse();

    // Selection is a two-pool decision (M2): ordinary candidates, newest
    // first, plus a separately-capped pool of `error` rows so a poisoned
    // subject can never occupy the whole budget.
    const selected: string[] = [];
    const stallSelected: string[] = [];
    const erroredCandidates: Array<{ date: string; verifiedAt: number }> = [];
    let deferred = 0;
    // Settled existing days seen so far, newest first — the re-verify lane's
    // candidate pool.
    let settledSeen = 0;

    for (const date of candidateDates) {
      const day = dayByDate.get(date);

      // A day still in progress is not settled; skip without deferring.
      if (day?.status === "open") continue;

      const isSettledExisting = day !== undefined;

      // Fold-drain guard (F1). A pending dirty mark means the fold has not
      // caught up: verifying now would contradict output the pipeline already
      // knows is stale, minting a phantom mismatch. Defer and count it.
      //
      // The deferral is deliberately UNBOUNDED — see the longer note at the
      // weekly lane's guard for why that is acceptable for now and how the
      // bounded form is tracked.
      if (await hasPendingDirtyMark(ctx, args.storeId, date)) {
        deferred += 1;
        continue;
      }

      // Counted only for dates that reach the selection decision: the
      // re-verify lane's window is "the most recent M settled days this tick
      // can actually act on".
      if (isSettledExisting) settledSeen += 1;

      const run = await loadRunRow(ctx, args.storeId, "day", date);

      // An `error` run row means the subject was never actually verified, so
      // it is always stale — but it goes to the capped error pool, not the
      // general one (M2).
      if (run !== null && run.outcome === "error") {
        erroredCandidates.push({ date, verifiedAt: run.verifiedAt });
        continue;
      }

      let stale: boolean;
      if (day?.certifiedFoldRevision !== undefined) {
        // Revision-driven selection: verify when the fold has produced output
        // newer than the last verified generation.
        stale =
          run === null ||
          run.verifiedCertifiedFoldRevision === undefined ||
          run.verifiedCertifiedFoldRevision < day.certifiedFoldRevision;
      } else {
        // Legacy (pre-stamping) fold or missing day: no revision to advance,
        // so verify exactly once; a later-stamped revision re-selects above.
        stale = run === null;
      }

      // Age-based re-verify lane: the most recent M settled folded days
      // re-verify regardless of revision (post-fold source-drift detection —
      // see the constant's doc). Admitted either on a scheduled re-verify
      // tick, OR whenever the row's own age has already exceeded the lane
      // cadence — the catch-up that makes a missed lane tick harmless (L3).
      const laneDue =
        args.reVerify ||
        (run !== null &&
          args.now - run.verifiedAt >=
            VERIFICATION_REVERIFY_EVERY_HOURS * 60 * 60 * 1000);
      const laneSelect =
        laneDue &&
        isSettledExisting &&
        settledSeen <= VERIFICATION_REVERIFY_RECENT_DAYS;

      if (!(stale || laneSelect)) continue;
      // Stall probes go to their own CAPPED pool so they can never crowd out
      // the store's real folded days (candidateDates is newest-first, and
      // every probe date is newer than the anchor by construction).
      if (stallProbeSet.has(date)) stallSelected.push(date);
      else selected.push(date);
    }

    // Error rows rotate through their capped slot OLDEST-first, so a
    // permanently failing recent day cannot starve an older failing one.
    const erroredSelected = erroredCandidates
      .sort((left, right) => left.verifiedAt - right.verifiedAt)
      .slice(0, VERIFICATION_ERROR_SLOTS_PER_STORE)
      .map((candidate) => candidate.date);

    const dates = [
      ...erroredSelected,
      ...stallSelected.slice(0, VERIFICATION_STALL_PROBE_SLOTS),
      ...selected,
    ].slice(0, VERIFICATION_DAYS_PER_STORE);

    return { dates, deferred };
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
  /**
   * Summed positive magnitude of the facts the fold EXCLUDED (quarantined or
   * foreign-currency), from the same bounded scan as `voidImpact`, or null
   * when that scan capped out. Bounds the classifier's `flagged_exclusions`
   * attribution — see the note on the scan below.
   */
  flaggedExclusionImpact: { revenueMinor: number; units: number } | null;
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
    //
    // The SAME scan sources the flagged-exclusion magnitude: the facts the
    // fold dropped (`quarantine` present, or a currency other than the
    // store's — foldDay.ts's two `continue`s) are exactly the rows the
    // verifier still counts, so their own magnitude is the largest delta a
    // flag can honestly explain. Recomputed from the fact rows rather than
    // trusted from `flags`, because `flags` records only that such facts
    // exist, never how much they are worth.
    const store = await ctx.db.get("store", args.storeId);
    const storeCurrency = normalizeCurrencyCode(store?.currency);
    const facts = await ctx.db
      .query("reportFact")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", args.storeId).eq("operatingDate", args.operatingDate),
      )
      .take(VERIFICATION_VOID_FACT_SCAN + 1);

    let voidImpact: DaySubjectGathering["voidImpact"];
    let flaggedExclusionImpact: DaySubjectGathering["flaggedExclusionImpact"];
    if (facts.length > VERIFICATION_VOID_FACT_SCAN) {
      // Fail closed on BOTH attributions: a partial sum is a lower bound, and
      // a lower bound used as an explanation ceiling would bless real defects.
      voidImpact = null;
      flaggedExclusionImpact = null;
    } else {
      let revenueMinor = 0;
      let units = 0;
      let excludedRevenueMinor = 0;
      let excludedUnits = 0;
      for (const fact of facts) {
        if (fact.factKind === "void") {
          revenueMinor += Math.abs(fact.grossAmountMinor);
          units += Math.abs(fact.quantity);
        }
        const excluded =
          fact.quarantine !== undefined ||
          normalizeCurrencyCode(fact.currency) !== storeCurrency;
        if (excluded) {
          // Widest of the fact's own revenue faces, so the single bound covers
          // whichever minor-unit metric the exclusion moved (gross vs net vs
          // the payment lanes) without ever exceeding the fact's own worth.
          excludedRevenueMinor += Math.max(
            Math.abs(fact.grossAmountMinor),
            Math.abs(fact.netAmountMinor),
            Math.abs(fact.paymentAllocationMinor ?? 0),
          );
          excludedUnits += Math.abs(fact.quantity);
        }
      }
      voidImpact = { revenueMinor, units };
      flaggedExclusionImpact = {
        revenueMinor: excludedRevenueMinor,
        units: excludedUnits,
      };
    }

    const result = await verifyDayWithCtx(
      ctx,
      args.storeId,
      args.operatingDate,
    );

    return {
      result,
      voidImpact,
      flaggedExclusionImpact,
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

export type WeeklySubjectSelection = {
  subjectKey: string;
  materializedAt: number;
  /** The pre-flight allocation probe exceeded
   * VERIFICATION_WEEK_ALLOCATION_PROBE: the single-execution weekly
   * verification is a plausible read-limit breach, so it is NOT run and the
   * subject records an honest `truncated` (H2). */
  overBudget: boolean;
};

/**
 * F1 — is the weekly projection known-stale right now?
 *
 * `verifyCurrentWeekWithCtx` recomputes expected totals from LIVE source rows
 * and compares them against `reportWeekCurrent`, which is rebuilt only by the
 * 5-minute reports sweep. A sale landing minutes before the tick is therefore
 * visible to the verifier but not yet to the projection — a PHANTOM weekly
 * mismatch that mints an alertable fingerprint (and fresh alert identities on
 * recurrence). The day lane already defers on pending `reportDirtyDay` marks;
 * this is the weekly lane's equivalent: any pending `reportDirtyWeek` mark,
 * or any pending `reportDirtyDay` mark for a date inside the current cycle
 * frame, means the fold has not drained yet — defer, exactly like a dirty
 * day. Both reads are bounded `.take(1)` existence probes on indexes.
 *
 * The weekly mark is SCOPED to the current cycle where it carries a cycle
 * identifier (`weekMarkBlocksCycle`), so an unrelated stale acceptance mark for
 * a past cycle cannot hold the current cycle's verification silent.
 */
type CycleFrame = { cycleStartDate: string; cycleEndDate: string };

/**
 * Does this `reportDirtyWeek` mark say anything about the CURRENT cycle?
 *
 * `reportDirtyWeek` is a per-store singleton, so one mark carries whatever the
 * pipeline last wanted done. Almost every reason means "rebuild the current
 * week", and those block. The exception is an `acceptance_requested` mark
 * whose durable `intent.cycleStartDate` names a DIFFERENT cycle: that is work
 * on a past week's accepted baseline, and it must not gate the current one —
 * unless its own `foldedDates` show a date inside the current frame, which is
 * the pipeline saying the current cycle moved too.
 */
function weekMarkBlocksCycle(
  mark: Doc<"reportDirtyWeek">,
  cycleFrame: CycleFrame | null,
): boolean {
  if (cycleFrame === null) return true;
  const intentCycle = mark.intent?.cycleStartDate;
  if (
    mark.reason !== "acceptance_requested" ||
    intentCycle === undefined ||
    intentCycle === cycleFrame.cycleStartDate
  ) {
    return true;
  }
  return (mark.foldedDates ?? []).some(
    (date) =>
      date >= cycleFrame.cycleStartDate && date <= cycleFrame.cycleEndDate,
  );
}

async function hasPendingWeeklyDirtyMarks(
  ctx: QueryCtx,
  storeId: Id<"store">,
  cycleFrame: CycleFrame | null,
): Promise<boolean> {
  const weekMarks = await ctx.db
    .query("reportDirtyWeek")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .take(1);
  const weekMark = weekMarks[0];
  if (weekMark !== undefined && weekMarkBlocksCycle(weekMark, cycleFrame)) {
    return true;
  }
  if (cycleFrame !== null) {
    const dayMarks = await ctx.db
      .query("reportDirtyDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q
          .eq("storeId", storeId)
          .gte("operatingDate", cycleFrame.cycleStartDate)
          .lte("operatingDate", cycleFrame.cycleEndDate),
      )
      .take(1);
    if (dayMarks.length > 0) return true;
  }
  return false;
}

function cycleFrameOf(current: Doc<"reportWeekCurrent">): CycleFrame | null {
  return "cycleStartDate" in current
    ? {
        cycleStartDate: current.cycleStartDate,
        cycleEndDate: current.cycleEndDate,
      }
    : null;
}

export const selectWeeklySubject = internalQuery({
  args: { storeId: v.id("store"), now: v.number() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    subject: WeeklySubjectSelection | null;
    /** True when a weekly subject was due but the fold is still draining
     * (pending dirty marks) — counted as weeksDeferred, mirroring the day
     * lane's daysDeferred. */
    deferred: boolean;
  }> => {
    const current = await ctx.db
      .query("reportWeekCurrent")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .unique();
    if (!current) return { subject: null, deferred: false };

    const subjectKey =
      "cycleStartDate" in current ? current.cycleStartDate : "current";

    const run = await loadRunRow(ctx, args.storeId, "week", subjectKey);

    if (run !== null) {
      // FREQUENCY BOUND (H1). `materializedAt` advances on every weekly
      // rebuild — every ~5 minutes for an actively-trading store — so the
      // revision gate below suppresses idle stores ONLY. The run row's own
      // age is the signal that actually bounds weekly cost.
      if (
        args.now - run.verifiedAt <
        VERIFICATION_WEEK_MIN_INTERVAL_HOURS * 60 * 60 * 1000
      ) {
        return { subject: null, deferred: false };
      }
      // Staleness gate: past the interval, still skip when the projection has
      // not been re-materialized since the last verified generation. An
      // `error` row has no verified generation and always re-runs.
      if (
        run.outcome !== "error" &&
        run.verifiedCertifiedFoldRevision !== undefined &&
        run.verifiedCertifiedFoldRevision >= current.materializedAt
      ) {
        return { subject: null, deferred: false };
      }
    }

    // Fold-drain guard (F1). The subject is due, but pending dirty marks mean
    // the fold has not caught up: verifying now would compare live source
    // totals against a projection the pipeline already knows is stale and mint
    // a phantom mismatch. Defer and count it (weeksDeferred).
    //
    // THE DEFERRAL IS DELIBERATELY UNBOUNDED, and that is a known, accepted
    // limitation rather than an oversight. A dirty mark is not guaranteed to
    // drain: `reports/sweeper.ts` re-marks a day `fact_cap_exceeded` on every
    // pass and re-marks `reportDirtyWeek` `write_failure` after every failed
    // `rebuildCurrentWeek`. A fold wedged that way will suppress verification
    // for that store indefinitely — deferral counters climb and no verdict is
    // ever recorded — which is exactly the situation verification exists to
    // surface.
    //
    // BOTH LANES are affected, not just this one. A wedged fold writes no
    // `reportDay` row, so those dates are reachable only through the day
    // lane's forward stall probe — and every one of them carries the live
    // dirty mark that defers it. The day lane is therefore not silent but
    // worse: the older already-folded days keep re-verifying on the age lane
    // and keep recording `clean`, so the store's run rows read healthy while
    // its fold is stuck.
    //
    // We accept this for now because alert emission is gated OFF for the
    // record-only rollout (R8), so the guard's present value is only keeping
    // run rows free of phantom mismatch/clean flapping, and a bound designed
    // without production evidence has already proven easy to get wrong (an
    // unbounded-then-bounded pair of review passes produced first a silenced
    // detector, then false alarms).
    //
    // BOUNDING THIS IS TRACKED AS V26-1202, WHICH BLOCKS ENABLING
    // `REPORTS_VERIFICATION_ALERT_EMAILS` FOR ANY STORE. Do not populate that
    // allowlist until it lands: with alerts on, a wedged fold would be
    // silently unmonitored rather than merely unrecorded. Note also that the
    // wedge ladder is NOT a compensating control here — a deferral does not
    // set `storeIncomplete`, so it never rings; whatever bound lands in
    // V26-1202 needs its own surfacing path (see V26-1203, the ledger rows
    // this sweep writes are not yet readable by any query).
    if (
      await hasPendingWeeklyDirtyMarks(ctx, args.storeId, cycleFrameOf(current))
    ) {
      return { subject: null, deferred: true };
    }

    // Pre-flight read-budget probe (H2). The union of the seven days' payment
    // windows, measured once; see VERIFICATION_WEEK_ALLOCATION_PROBE.
    const probeEndAt =
      "cycleEndDate" in current
        ? Date.parse(`${current.cycleEndDate}T00:00:00.000Z`) + DAY_MS
        : current.materializedAt;
    const allocationProbe = await ctx.db
      .query("paymentAllocation")
      .withIndex("by_storeId_recordedAt", (q) =>
        q
          .eq("storeId", args.storeId)
          .gte("recordedAt", probeEndAt - VERIFICATION_WEEK_PROBE_LOOKBACK_MS)
          .lte("recordedAt", probeEndAt),
      )
      .take(VERIFICATION_WEEK_ALLOCATION_PROBE + 1);

    return {
      subject: {
        subjectKey,
        materializedAt: current.materializedAt,
        overBudget: allocationProbe.length > VERIFICATION_WEEK_ALLOCATION_PROBE,
      },
      deferred: false,
    };
  },
});

export const verifyWeekSubject = internalQuery({
  args: { storeId: v.id("store") },
  handler: async (
    ctx,
    args,
  ): Promise<
    { deferred: true } | { deferred: false; result: VerifyCurrentWeekResult }
  > => {
    // F1, second gate: selection ran in its OWN query execution, so a dirty
    // mark can land between it and this one. Re-checking HERE shares a
    // snapshot with the verification's source reads, which closes the window
    // completely — a mark visible to this execution means the source rows it
    // reads have moved past the projection, and verifying would compare
    // across generations.
    const current = await ctx.db
      .query("reportWeekCurrent")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .unique();
    if (
      await hasPendingWeeklyDirtyMarks(
        ctx,
        args.storeId,
        current ? cycleFrameOf(current) : null,
      )
    ) {
      return { deferred: true };
    }
    return {
      deferred: false,
      result: await verifyCurrentWeekWithCtx(ctx, args.storeId),
    };
  },
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
    alertSeq: number;
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
      alertSeq: args.alertSeq,
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
    // Monotonic across ticks: absent on rows written before the column
    // landed, which restart the counter at 0 exactly once.
    alertSeq: row.alertSeq ?? 0,
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

    // C1 — persist the STREAK's unexplained set, not this run's raw one.
    // `nextStreakState` carries the previous fingerprint and streak forward on
    // partial/truncated/error/unavailable runs; writing `args.unexplained`
    // there would wipe the tracked field list while keeping the fingerprint,
    // and the NEXT tick would read `unexplainedFields: []` and confirm
    // cleanliness vacuously — declaring the discrepancy resolved without ever
    // re-checking it, and permanently suppressing a not-yet-dispatched alert
    // via the payload query. Summaries for carried-forward fields are taken
    // from this run where present and otherwise from the stored row, so the
    // recorded expected/actual amounts stay the ones the fingerprint hashes.
    const summaryByField = new Map<string, DifferenceSummary>();
    for (const difference of existing?.unexplainedDifferences ?? []) {
      summaryByField.set(difference.field, difference);
    }
    for (const difference of args.unexplained) {
      summaryByField.set(difference.field, difference);
    }
    const unexplainedDifferences: DifferenceSummary[] =
      state.unexplainedFields.map(
        (field) =>
          summaryByField.get(field) ?? {
            field,
            classification: "unexplained",
          },
      );

    // F6 — mirror the C1 carry-forward for checkedFields. On a
    // non-confirming run that checked nothing (error/truncated/unavailable
    // all record `checkedFields: []`) the streak's fingerprint and difference
    // summaries survive above, so the checked list they were recorded under
    // must survive with them: overwriting it with [] makes a delayed alert
    // email render the same field as both "checked and wrong" (from the
    // carried differences) and "not checked" (as the complement of an empty
    // checked list). While the streak is live, an empty checked list from a
    // could-not-check run keeps the last real one.
    //
    // B4 — carry the stored value THROUGH, including its absence. The schema
    // defines absent as "unknown, never nothing was checked", and the alert
    // email honours that (`?? inventory`). Defaulting an absent stored value to
    // `args.checkedFields` — which is `[]` on exactly this path — would degrade
    // "unknown" into the very claim F6 exists to prevent. `undefined` here
    // leaves the column absent on both the patch and the insert.
    const checkedFields: string[] | undefined =
      args.checkedFields.length === 0 &&
      state.fingerprint !== null &&
      existing !== null
        ? existing.checkedFields
        : args.checkedFields;

    const rowDoc = {
      storeId: args.storeId,
      subjectKind: args.subjectKind,
      subjectKey: args.subjectKey,
      outcome: args.outcome,
      explainedDifferences: args.explained,
      unexplainedDifferences,
      // Persisted for the U5 alert email: its complement within the subject's
      // field inventory is what verification declined to check.
      checkedFields,
      // `undefined` on patch is an explicit erase — a cleared streak must not
      // keep a stale fingerprint or alert marker.
      unexplainedFingerprint: state.fingerprint ?? undefined,
      streakCount: state.streakCount,
      lastAlertedFingerprint: state.lastAlertedFingerprint ?? undefined,
      reArmEpoch: state.reArmEpoch,
      // Monotonic; never reset, so an oscillating fingerprint (A->B->A with no
      // intervening clean run) still mints a distinct alert identity.
      alertSeq: state.alertSeq,
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
        alertSeq: state.alertSeq,
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
    const previousMarker = existing?.lastAlertedFingerprint;

    let streakCount: number;
    let reArmEpoch = previousEpoch;
    let marker: string | undefined;
    let escalated = false;

    if (args.incomplete) {
      streakCount = previousStreak + 1;
      // The marker records WHICH ladder rung was last rung, so a store that
      // stays wedged re-escalates at the next rung instead of going silent
      // forever after the first (M1).
      const rungMarker = `${WEDGE_ALERTED_MARKER}:${streakCount}`;
      marker = previousMarker;
      if (shouldEscalateWedge(streakCount) && previousMarker !== rungMarker) {
        // The event table dedupes on (store, subject, type, metadata dedupe
        // keys). `escalationEpoch` changes only when a complete tick re-arms,
        // so a NEW streak escalates again; `consecutiveIncompleteTicks` is
        // also a dedupe key so each LADDER RUNG within one streak is a
        // distinct event rather than a swallowed duplicate.
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
          metadataDedupeKeys: ["escalationEpoch", "consecutiveIncompleteTicks"],
          reason: "verification_runner_wedged",
          storeId: args.storeId,
          subjectId: String(args.storeId),
          subjectLabel: "Report verification runner",
          subjectType: "report_verification_runner",
          ...(args.organizationId
            ? { organizationId: args.organizationId }
            : {}),
        });
        marker = rungMarker;
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
  /** Allowlist entries that were not valid, existing store ids (F3) — the sum
   * of the two counters below, kept as the headline number. */
  storesSkippedInvalid: number;
  /** Of those, entries that are not store ids at all (malformed env text). */
  storesSkippedMalformed: number;
  /** Of those, well-formed ids whose store doc no longer exists (B6). */
  storesSkippedMissing: number;
  daysVerified: number;
  /** Day subjects skipped because the fold had not drained (F1). */
  daysDeferred: number;
  weeksVerified: number;
  /** Weekly subjects deferred because the fold was still draining — pending
   * reportDirtyWeek / in-frame reportDirtyDay marks (F1). */
  weeksDeferred: number;
  subjectsErrored: number;
  /** Subjects whose run transitioned to alertable this tick (recorded even
   * while the email gate is off — the R8 record-only rollout). */
  alertTransitions: number;
  /** Of those, how many the enabled email gate would have emitted for. */
  emitsWouldFire: number;
  wedgeEscalations: number;
  /** Weekly subjects the pre-flight read-budget probe declined to run,
   * recorded as `truncated` instead (H2). */
  weeksOverBudget: number;
  /** Stores whose tick did not complete (a subject or a selection failed).
   * Drives the honest system-scope ledger row (M3). */
  storesIncomplete: number;
};

/** Consistent with `bestEffortRecordScheduledRunEvidence`: a swallowed write
 * still leaves a trace, so a persistently failing bookkeeping path is
 * discoverable instead of silent (L1). */
function logSwallowed(
  stage: string,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  console.error("[REPORT-VERIFICATION] Contained failure", {
    stage,
    ...context,
    error,
  });
}

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

  // F3 — the candidates query is the tick's only uncontained stage: an
  // unexpected throw here used to kill the whole tick with NO ledger row at
  // all, indistinguishable from the cron never firing. Contain it, and
  // best-effort record a FAILED system-scope row so the dead tick is visible
  // inside its run-key window rather than absent.
  let candidates: StoreCandidate[] = [];
  let storesSkippedReseeding = 0;
  let storesSkippedMalformed = 0;
  let storesSkippedMissing = 0;
  try {
    ({
      candidates,
      storesSkippedReseeding,
      storesSkippedMalformed,
      storesSkippedMissing,
    } = await ctx.runQuery(
      internal.reports.verificationSweep.listVerificationStoreCandidates,
      { now },
    ));
  } catch (error) {
    logSwallowed("store_candidates", error);
    try {
      await ctx.runMutation(
        internal.automation.scheduledRunLedger.recordScheduledRunEvidence,
        {
          cronFamily: VERIFICATION_CRON_FAMILY,
          now,
          scope: "system",
          visibility: "support",
          outcome: deriveScheduledRunOutcome({
            candidateCount: 1,
            succeededCount: 0,
            failedCount: 1,
          }),
          candidateCount: 1,
          processedCount: 1,
          succeededCount: 0,
          failedCount: 1,
          skippedCount: 0,
          sourceSubjectType: "reportVerificationRun",
          sampleSubjectIds: [],
          snapshotCounts: { candidateSelectionFailed: 1 },
        },
      );
    } catch (ledgerError) {
      // Even the evidence write failed; the log line above is the trace.
      logSwallowed("system_ledger_evidence", ledgerError);
    }
    return {
      storesScanned: 0,
      storesSkippedReseeding: 0,
      storesSkippedInvalid: 0,
      storesSkippedMalformed: 0,
      storesSkippedMissing: 0,
      daysVerified: 0,
      daysDeferred: 0,
      weeksVerified: 0,
      weeksDeferred: 0,
      subjectsErrored: 1,
      alertTransitions: 0,
      emitsWouldFire: 0,
      wedgeEscalations: 0,
      weeksOverBudget: 0,
      storesIncomplete: 0,
    };
  }

  const result: VerificationSweepResult = {
    storesScanned: candidates.length,
    storesSkippedReseeding,
    storesSkippedInvalid: storesSkippedMalformed + storesSkippedMissing,
    storesSkippedMalformed,
    storesSkippedMissing,
    daysVerified: 0,
    daysDeferred: 0,
    weeksVerified: 0,
    weeksDeferred: 0,
    subjectsErrored: 0,
    alertTransitions: 0,
    emitsWouldFire: 0,
    wedgeEscalations: 0,
    weeksOverBudget: 0,
    storesIncomplete: 0,
  };

  for (const candidate of candidates) {
    // Per-store completeness for the wedge counter: a tick is complete for a
    // store when selection succeeded and no subject recorded `error`.
    let storeIncomplete = false;

    // Per-store ledger counters (snapshot of this store's slice of the tick).
    // B5 — every counter the tick-scope result carries has a per-store twin
    // here, so the store-scope ledger snapshot is a true slice of the tick
    // rather than a subset that silently omits whichever counters were added
    // last (`weeksOverBudget` had drifted out of this object).
    const storeCounts = {
      daysVerified: 0,
      daysDeferred: 0,
      weeksVerified: 0,
      weeksDeferred: 0,
      weeksOverBudget: 0,
      subjectsErrored: 0,
      alertTransitions: 0,
      emitsWouldFire: 0,
      wedgeEscalations: 0,
    };

    // --- Day lane ----------------------------------------------------------
    let dates: string[] = [];
    try {
      const selection = await ctx.runQuery(
        internal.reports.verificationSweep.selectVerificationDaySubjects,
        { storeId: candidate.storeId, reVerify, now },
      );
      dates = selection.dates;
      result.daysDeferred += selection.deferred;
      storeCounts.daysDeferred += selection.deferred;
    } catch (error) {
      // M3: a crashed selection is a FAILED subject for evidence purposes —
      // counting it only as "incomplete" made the ledger record `applied` /
      // `no_candidates` for a tick that crashed.
      logSwallowed("day_selection", error, { storeId: candidate.storeId });
      result.subjectsErrored += 1;
      storeCounts.subjectsErrored += 1;
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
            ...(gathering.flaggedExclusionImpact
              ? { flaggedExclusionImpact: gathering.flaggedExclusionImpact }
              : {}),
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
      } catch (error) {
        // Containment: one subject's failure records `error` and the tick
        // moves on. The error row keeps the subject selected next tick.
        logSwallowed("day_subject", error, {
          storeId: candidate.storeId,
          operatingDate,
        });
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
        } catch (recordError) {
          // Even the error record failed; the wedge counter carries it.
          logSwallowed("day_error_record", recordError, {
            storeId: candidate.storeId,
            operatingDate,
          });
        }
      }
    }

    // --- Weekly lane -------------------------------------------------------
    try {
      const weeklySelection = await ctx.runQuery(
        internal.reports.verificationSweep.selectWeeklySubject,
        { storeId: candidate.storeId, now },
      );
      if (weeklySelection.deferred) {
        // F1: the fold is still draining — verifying now would compare live
        // source totals against a projection the pipeline already knows is
        // stale, and mint a phantom alert. Mirrors daysDeferred.
        result.weeksDeferred += 1;
        storeCounts.weeksDeferred += 1;
      }
      const weekly = weeklySelection.subject;
      if (weekly !== null) {
        try {
          // H2 containment: over the pre-flight read budget the weekly
          // verification is NOT attempted. `truncated` is the honest record —
          // could-not-check, never alertable — where actually running it would
          // breach the per-transaction ceiling and record `error`.
          // `null` classification = the verify execution deferred (F1).
          let classification: VerificationClassification | null;
          if (weekly.overBudget) {
            classification = {
              outcome: "truncated",
              explained: [],
              unexplained: [],
              fingerprint: null,
              alertable: false,
              checkedFields: [],
            };
          } else {
            const verified = await ctx.runQuery(
              internal.reports.verificationSweep.verifyWeekSubject,
              { storeId: candidate.storeId },
            );
            if (verified.deferred) {
              // F1, closed window: a dirty mark landed between selection and
              // verification. The verify execution saw it in the SAME
              // snapshot as its source reads, so nothing is recorded — defer
              // to a later tick, exactly like the selection-time guard.
              result.weeksDeferred += 1;
              storeCounts.weeksDeferred += 1;
              classification = null;
            } else {
              classification = classifyWeekResult(verified.result, {
                storeAllowlisted: true,
              });
            }
          }
          if (classification !== null) {
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
            if (weekly.overBudget) {
              result.weeksOverBudget += 1;
              storeCounts.weeksOverBudget += 1;
            }
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
          }
        } catch (error) {
          logSwallowed("week_subject", error, {
            storeId: candidate.storeId,
            subjectKey: weekly.subjectKey,
          });
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
          } catch (recordError) {
            // Carried by the wedge counter.
            logSwallowed("week_error_record", recordError, {
              storeId: candidate.storeId,
              subjectKey: weekly.subjectKey,
            });
          }
        }
      }
    } catch (error) {
      // M3: as with the day lane, a crashed weekly SELECTION is a failure the
      // ledger has to see, not a silent "incomplete".
      logSwallowed("week_selection", error, { storeId: candidate.storeId });
      result.subjectsErrored += 1;
      storeCounts.subjectsErrored += 1;
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
      if (health.escalated) {
        result.wedgeEscalations += 1;
        storeCounts.wedgeEscalations += 1;
      }
    } catch (error) {
      // Health recording itself failing leaves the previous streak in place;
      // the next tick's write catches up.
      logSwallowed("store_tick_health", error, { storeId: candidate.storeId });
    }
    if (storeIncomplete) result.storesIncomplete += 1;

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
          skippedCount: storeCounts.daysDeferred + storeCounts.weeksDeferred,
          sourceSubjectType: "reportVerificationRun",
          sampleSubjectIds: [candidate.storeId],
          snapshotCounts: {
            ...storeCounts,
            incomplete: storeIncomplete ? 1 : 0,
          },
        },
      );
    } catch (error) {
      // Ledger bookkeeping is observational; never fail the tick on it.
      logSwallowed("store_ledger_evidence", error, {
        storeId: candidate.storeId,
      });
    }
  }

  // --- System-scope ledger summary -----------------------------------------
  // M3: a store whose tick did not complete is a FAILED store here. Hardcoding
  // `succeededCount: storesScanned, failedCount: 0` recorded success for a
  // tick in which every subject errored.
  const storesSucceeded = result.storesScanned - result.storesIncomplete;
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
          succeededCount: storesSucceeded,
          failedCount: result.storesIncomplete,
        }),
        candidateCount: result.storesScanned,
        processedCount: result.storesScanned,
        succeededCount: storesSucceeded,
        failedCount: result.storesIncomplete,
        // B6 — an allowlist entry that names no store is neither a candidate
        // nor, before this, a skip: it appeared in NEITHER number on the row
        // shape a reader actually projects. Both skip classes belong here, the
        // way the store rows count daysDeferred + weeksDeferred.
        skippedCount:
          result.storesSkippedReseeding + result.storesSkippedInvalid,
        sourceSubjectType: "reportVerificationRun",
        sampleSubjectIds: candidates.map((c) => c.storeId).slice(0, 25),
        snapshotCounts: {
          daysVerified: result.daysVerified,
          daysDeferred: result.daysDeferred,
          weeksVerified: result.weeksVerified,
          weeksDeferred: result.weeksDeferred,
          storesSkippedReseeding: result.storesSkippedReseeding,
          storesSkippedInvalid: result.storesSkippedInvalid,
          storesSkippedMalformed: result.storesSkippedMalformed,
          storesSkippedMissing: result.storesSkippedMissing,
          subjectsErrored: result.subjectsErrored,
          alertTransitions: result.alertTransitions,
          emitsWouldFire: result.emitsWouldFire,
          wedgeEscalations: result.wedgeEscalations,
          weeksOverBudget: result.weeksOverBudget,
          storesIncomplete: result.storesIncomplete,
        },
      },
    );
  } catch (error) {
    // Same containment as the store rows.
    logSwallowed("system_ledger_evidence", error);
  }

  return result;
}

/** The scheduled entry point (registered in crons.ts by U4). */
export const runVerificationSweep = internalAction({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<VerificationSweepResult> =>
    runVerificationSweepWithCtx(ctx, args),
});
