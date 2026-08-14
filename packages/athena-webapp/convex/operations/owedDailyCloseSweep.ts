/**
 * Owed daily-close sweep.
 *
 * `runConfiguredDailyOperationsAutomation` closes a store day inside a narrow
 * eligibility window: from the policy's local completion window until the
 * two-hour catch-up lookback expires. If a blocker is present for that whole
 * window and clears afterwards, nothing ever revisits the day — the books stay
 * open permanently and only a support-invoked mutation can finish them.
 *
 * That is what happened on 2026-07-24: a wedged POS sync held the register
 * close event, so the day carried a `register_session` blocker through all five
 * eligibility runs, and the wedge cleared 76 minutes after the last one.
 *
 * This sweep removes the cliff. Instead of asking "is now the right time to
 * close today?", it asks "which store days are still owed a close, and is each
 * one closeable now?" — then delegates each owed date to the existing
 * support-hardened `runHistoricEodAutoCloseForDate`, which already carries the
 * idempotency key, schedule-range resolution, quarantine rules, and historical
 * currentness mode.
 *
 * Two properties matter for safety:
 *
 * - The owed set is **derived**, never stored. `dailyClose` rows are already
 *   the authority on which days are closed; a parallel "owed days" table could
 *   drift from them, and drift in an accounting ledger is worse than the
 *   original bug.
 * - A day is only ever closed when the decision adapter judges it eligible. A
 *   persistent blocker — a real cash variance, a pending manager approval —
 *   keeps the day open no matter how old it gets, and past the staleness
 *   threshold it is escalated to an operational event so it surfaces to a human
 *   instead of being retried invisibly forever.
 */

import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server";
import {
  addDaysToOperatingDate,
  isValidOperatingDate,
  operatingDateForPolicy,
} from "./dailyOperationsAutomation";
import { recordOperationalEventWithCtx } from "./operationalEvents";
import { emitNotificationWithCtx } from "../notifications/emit";

const DAILY_OPERATIONS_AUTOMATION_DOMAIN = "daily_operations";
const EOD_AUTO_COMPLETE_ACTION = "eod.auto_complete";

/** How far back an unattended sweep will reach. Covers a long weekend plus a
 * holiday; beyond this a backlog is systemic and wants a human. */
export const OWED_DAILY_CLOSE_LOOKBACK_DAYS = 7;

/** Dates attempted per store per sweep, so a backlog drains gradually rather
 * than closing a week of books in one mutation storm. */
export const OWED_DAILY_CLOSE_MAX_PER_SWEEP = 3;

/** How old an owed day may get before it is escalated to a human. Transient
 * blockers clear well inside this; anything older is a real problem. */
export const OWED_DAILY_CLOSE_STALE_AFTER_DAYS = 2;

const OWED_DAILY_CLOSE_STALE_EVENT_TYPE = "daily_close.owed_stale";

export type OwedDailyCloseSelection = {
  /** Every unclosed date inside the lookback window, oldest first. */
  owed: string[];
  /** The bounded slice this sweep will act on, oldest first. */
  attempt: string[];
  /** Owed dates past the staleness threshold; these need a human. */
  stale: string[];
};

export function dailyCloseSweepResultSettled(result: { action: string }) {
  return result.action === "applied" || result.action === "already_completed";
}

// Production runs hourly and non-production every two hours. An hour-based
// slot advances the start by one in prod and two in non-prod; with a
// three-date attempt window both cadences cover every backlog length allowed
// by the seven-day lookback (including even lengths where a point cursor with
// a two-step stride would otherwise starve one parity).
const OWED_DAILY_CLOSE_ROTATION_MS = 60 * 60_000;

export function selectRotatingOwedDailyCloseAttempt(input: {
  asOfOperatingDate: string;
  now: number;
  owed: string[];
  maxPerSweep?: number;
}) {
  if (input.owed.length === 0) return [];
  const maxPerSweep = input.maxPerSweep ?? OWED_DAILY_CLOSE_MAX_PER_SWEEP;
  const dayStart = Date.parse(`${input.asOfOperatingDate}T00:00:00.000Z`);
  const slot = Math.max(
    0,
    Math.floor((input.now - dayStart) / OWED_DAILY_CLOSE_ROTATION_MS),
  );
  const start = slot % input.owed.length;
  return Array.from(
    { length: Math.min(maxPerSweep, input.owed.length) },
    (_, offset) => input.owed[(start + offset) % input.owed.length],
  );
}

/**
 * Pure selection of which store days are still owed a close.
 *
 * The candidate window is the `lookbackDays` operating dates ending yesterday —
 * today is deliberately excluded, since a day still in progress is not owed a
 * close and `runHistoricEodAutoCloseForDate` would quarantine it anyway.
 */
export function selectOwedDailyCloseDates(input: {
  asOfOperatingDate: string;
  completedOperatingDates: string[];
  lookbackDays?: number;
  maxPerSweep?: number;
  staleAfterDays?: number;
}): OwedDailyCloseSelection {
  const empty: OwedDailyCloseSelection = { owed: [], attempt: [], stale: [] };

  if (!isValidOperatingDate(input.asOfOperatingDate)) {
    return empty;
  }

  const lookbackDays = input.lookbackDays ?? OWED_DAILY_CLOSE_LOOKBACK_DAYS;
  const maxPerSweep = input.maxPerSweep ?? OWED_DAILY_CLOSE_MAX_PER_SWEEP;
  const staleAfterDays =
    input.staleAfterDays ?? OWED_DAILY_CLOSE_STALE_AFTER_DAYS;

  if (lookbackDays < 1 || maxPerSweep < 1) {
    return empty;
  }

  const completed = new Set(input.completedOperatingDates);
  const staleOnOrBefore = addDaysToOperatingDate(
    input.asOfOperatingDate,
    -staleAfterDays,
  );

  const owed: string[] = [];
  for (let offset = lookbackDays; offset >= 1; offset -= 1) {
    const operatingDate = addDaysToOperatingDate(
      input.asOfOperatingDate,
      -offset,
    );
    if (!completed.has(operatingDate)) {
      owed.push(operatingDate);
    }
  }

  return {
    owed,
    attempt: owed.slice(0, maxPerSweep),
    stale: owed.filter((operatingDate) => operatingDate <= staleOnOrBefore),
  };
}

type OwedDailyCloseStoreCandidate = {
  asOfOperatingDate: string;
  organizationId?: Id<"organization">;
  storeId: Id<"store">;
} & OwedDailyCloseSelection;

const OWED_DAILY_CLOSE_POLICY_PAGE_SIZE = 50;

async function completedOperatingDatesForStore(
  ctx: QueryCtx,
  args: {
    policy: Doc<"automationPolicy">;
    fromOperatingDate: string;
    toOperatingDate: string;
  },
) {
  const closes = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_status_operatingDate", (q) =>
      q
        .eq("storeId", args.policy.storeId)
        .eq("status", "completed")
        .gte("operatingDate", args.fromOperatingDate)
        .lte("operatingDate", args.toOperatingDate),
    )
    .take(OWED_DAILY_CLOSE_LOOKBACK_DAYS * 4);

  // A superseded close does not settle the day; only the active record counts.
  return closes
    .filter((close) => close.lifecycleStatus === "active")
    .map((close) => close.operatingDate);
}

async function candidatesForPolicies(
  ctx: QueryCtx,
  policies: Doc<"automationPolicy">[],
  now: number,
) {
    const candidates: OwedDailyCloseStoreCandidate[] = [];

    for (const policy of policies.filter((entry) => entry.paused !== true)) {
      const asOfOperatingDate = operatingDateForPolicy({
        now,
        operatingTimezoneOffsetMinutes: policy.operatingTimezoneOffsetMinutes,
      });
      if (!asOfOperatingDate) continue;

      const completedOperatingDates = await completedOperatingDatesForStore(
        ctx,
        {
          policy,
          fromOperatingDate: addDaysToOperatingDate(
            asOfOperatingDate,
            -OWED_DAILY_CLOSE_LOOKBACK_DAYS,
          ),
          toOperatingDate: asOfOperatingDate,
        },
      );

      const selection = selectOwedDailyCloseDates({
        asOfOperatingDate,
        completedOperatingDates,
      });

      if (selection.owed.length === 0) continue;

      candidates.push({
        ...selection,
        asOfOperatingDate,
        ...(policy.organizationId
          ? { organizationId: policy.organizationId }
          : {}),
        storeId: policy.storeId,
      });
    }

  return candidates;
}

export const listOwedDailyCloseCandidatePage = internalQuery({
  args: { cursor: v.optional(v.string()), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("automationPolicy")
      .withIndex("by_domain_action_mode", (q) =>
        q
          .eq("domain", DAILY_OPERATIONS_AUTOMATION_DOMAIN)
          .eq("action", EOD_AUTO_COMPLETE_ACTION)
          .eq("mode", "enabled"),
      )
      .paginate({
        cursor: args.cursor ?? null,
        numItems: OWED_DAILY_CLOSE_POLICY_PAGE_SIZE,
      });
    return {
      candidates: await candidatesForPolicies(
        ctx,
        page.page,
        args.now ?? Date.now(),
      ),
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

// Retained as a focused first-page inspection surface for existing tests and
// support diagnostics. The action below owns continuation across every page.
export const listOwedDailyCloseCandidates = internalQuery({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<OwedDailyCloseStoreCandidate[]> => {
    const page = await ctx.db
      .query("automationPolicy")
      .withIndex("by_domain_action_mode", (q) =>
        q
          .eq("domain", DAILY_OPERATIONS_AUTOMATION_DOMAIN)
          .eq("action", EOD_AUTO_COMPLETE_ACTION)
          .eq("mode", "enabled"),
      )
      .take(OWED_DAILY_CLOSE_POLICY_PAGE_SIZE);
    return candidatesForPolicies(ctx, page, args.now ?? Date.now());
  },
});

export const recordOwedDailyCloseStaleEscalation = internalMutation({
  args: {
    ageInDays: v.number(),
    operatingDate: v.string(),
    organizationId: v.optional(v.id("organization")),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const completedClose = await ctx.db
      .query("dailyClose")
      .withIndex("by_storeId_operatingDate_lifecycleStatus", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("operatingDate", args.operatingDate)
          .eq("lifecycleStatus", "active"),
      )
      .first();
    if (completedClose?.status === "completed") return false;

    // Dedupes on (store, subject, event type), so a day that stays stuck
    // escalates once rather than every sweep.
    await recordOperationalEventWithCtx(ctx, {
      actorType: "automation",
      eventType: OWED_DAILY_CLOSE_STALE_EVENT_TYPE,
      message: `End of day review for ${args.operatingDate} has been outstanding for ${args.ageInDays} days and cannot be completed automatically.`,
      metadata: {
        ageInDays: args.ageInDays,
        operatingDate: args.operatingDate,
      },
      reason: "daily_close_owed_stale",
      storeId: args.storeId,
      subjectId: args.operatingDate,
      subjectLabel: `End of day review ${args.operatingDate}`,
      subjectType: "daily_close",
      ...(args.organizationId ? { organizationId: args.organizationId } : {}),
    });

    await emitNotificationWithCtx(ctx, {
      kind: "eod.stale_daily_close",
      storeId: args.storeId,
      ...(args.organizationId ? { organizationId: args.organizationId } : {}),
      subjectId: `${args.storeId}:${args.operatingDate}`,
      subjectType: "dailyClose",
      payload: {
        ageInDays: args.ageInDays,
        operatingDate: args.operatingDate,
        storeId: args.storeId,
      },
    });
    return true;
  },
});

type OwedDailyCloseSweepResult = {
  escalations: Array<{ operatingDate: string; storeId: Id<"store"> }>;
  mode: "dry_run" | "apply";
  results: Array<{
    action: string;
    classification: string;
    operatingDate: string;
    storeId: Id<"store">;
  }>;
  scannedStoreCount: number;
};

/**
 * Closes store days that missed their eligibility window but have since become
 * eligible, and escalates the ones that have not.
 *
 * The explicit result annotation is load-bearing: this handler reaches back
 * into its own module through `internal.`, and without it TypeScript cannot
 * break the inference cycle.
 */
export const runOwedDailyCloseSweep = internalAction({
  args: {
    cursor: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("dry_run"), v.literal("apply"))),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<OwedDailyCloseSweepResult> => {
    const mode = args.mode ?? "apply";
    const now = args.now ?? Date.now();
    const page: {
      candidates: OwedDailyCloseStoreCandidate[];
      continueCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(
      internal.operations.owedDailyCloseSweep.listOwedDailyCloseCandidatePage,
      {
        ...(args.cursor ? { cursor: args.cursor } : {}),
        ...(args.now === undefined ? {} : { now: args.now }),
      },
    );
    const candidates = page.candidates;

    const results: OwedDailyCloseSweepResult["results"] = [];
    const escalations: Array<{ operatingDate: string; storeId: Id<"store"> }> =
      [];

    for (const candidate of candidates) {
      const attempt = selectRotatingOwedDailyCloseAttempt({
        asOfOperatingDate: candidate.asOfOperatingDate,
        now,
        owed: candidate.owed,
      });
      for (const operatingDate of attempt) {
        const result = await ctx.runMutation(
          internal.operations.dailyOperationsAutomation
            .runHistoricEodAutoCloseForDate,
          {
            asOfOperatingDate: candidate.asOfOperatingDate,
            mode,
            operatingDate,
            storeId: candidate.storeId,
          },
        );

        results.push({
          action: result.action,
          classification: result.classification ?? "unknown",
          operatingDate,
          storeId: candidate.storeId,
        });
      }

      // Escalate only what this sweep could not settle, so a day that just
      // closed above never raises a stale alert on its way out.
      const closedThisSweep = new Set(
        results
          .filter(
            (result) =>
              result.storeId === candidate.storeId &&
              dailyCloseSweepResultSettled(result),
          )
          .map((result) => result.operatingDate),
      );

      const attemptedDates = new Set(attempt);
      for (const operatingDate of candidate.stale) {
        if (!attemptedDates.has(operatingDate)) continue;
        if (closedThisSweep.has(operatingDate)) continue;
        if (mode === "dry_run") {
          escalations.push({ operatingDate, storeId: candidate.storeId });
          continue;
        }

        const recorded = await ctx.runMutation(
          internal.operations.owedDailyCloseSweep
            .recordOwedDailyCloseStaleEscalation,
          {
            ageInDays: daysBetweenOperatingDates(
              operatingDate,
              candidate.asOfOperatingDate,
            ),
            operatingDate,
            ...(candidate.organizationId
              ? { organizationId: candidate.organizationId }
              : {}),
            storeId: candidate.storeId,
          },
        );
        if (recorded) {
          escalations.push({ operatingDate, storeId: candidate.storeId });
        }
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.operations.owedDailyCloseSweep.runOwedDailyCloseSweep,
        {
          cursor: page.continueCursor,
          mode,
          ...(args.now === undefined ? {} : { now: args.now }),
        },
      );
    }

    return {
      escalations,
      mode,
      results,
      scannedStoreCount: candidates.length,
    };
  },
});

function daysBetweenOperatingDates(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      (24 * 60 * 60_000),
  );
}
