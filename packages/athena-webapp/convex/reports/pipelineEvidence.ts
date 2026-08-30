import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  buildScheduledRunKey,
  recordScheduledRunEvidenceWithCtx,
  resolveScheduledWindow,
  type ScheduledCronFamily,
  type ScheduledRunLedgerOutcome,
} from "../automation/scheduledRunLedger";

export const PIPELINE_CRON_FAMILY_BY_LANE = {
  fold: "reports-pipeline-fold",
  "close-evidence": "reports-pipeline-close-evidence",
  "resolve-week-date": "reports-pipeline-resolve-week-date",
  current: "reports-pipeline-current",
  accept: "reports-pipeline-accept",
  refresh: "reports-pipeline-refresh",
  rollup: "reports-pipeline-rollup",
  overview: "reports-pipeline-overview",
  inventory: "reports-pipeline-inventory",
  legacy: "reports-pipeline-legacy",
  maintenance: "reports-pipeline-maintenance",
} as const satisfies Record<string, ScheduledCronFamily>;

export type PipelineEvidenceLane = keyof typeof PIPELINE_CRON_FAMILY_BY_LANE;
export type PipelineOutcome =
  "applied" | "blocked" | "failed" | "stale" | "deferred";
const TERMINAL_DISPOSITIONS = [
  "outside_schedule_history",
  "obsolete_close",
  "cycle_owned",
  "before_acceptance_floor",
  "schedule_changed",
  "no_active_close",
] as const;
export type PipelineTerminalDisposition =
  (typeof TERMINAL_DISPOSITIONS)[number];

export type PipelineOutcomeInput = {
  storeId?: Id<"store">;
  lane: PipelineEvidenceLane;
  now: number;
  outcome: PipelineOutcome;
  terminalDisposition?: PipelineTerminalDisposition;
  oldestAgeMs?: number;
  saturated?: boolean;
  /** Deliberately never serialized: source exceptions can contain private data. */
  error?: unknown;
};

export type PipelineBacklogInput = {
  storeId?: Id<"store">;
  lane: PipelineEvidenceLane;
  now: number;
  /** Bounded eligible sample (including a sentinel), never a total backlog. */
  eligibleSampleCount: number;
  oldestAgeMs?: number;
  saturated?: boolean;
};

function boundedCount(value = 0): number {
  return Number.isFinite(value)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)))
    : 0;
}

function ledgerOutcome(
  counts: Record<PipelineOutcome, number>,
): ScheduledRunLedgerOutcome {
  if (counts.applied > 0 && (counts.failed > 0 || counts.blocked > 0)) {
    return "partial_failure";
  }
  if (counts.failed > 0) return "failed";
  return counts.applied > 0 ? "applied" : "support_only";
}

/**
 * Accumulate validated attempt outcomes, not dispatcher candidates or billing
 * reads. Call only after the caller's claim/generation check, in the mutation
 * committing the outcome; a replay refused by that check must not call again.
 * This helper does not claim work or provide separate exactly-once authority.
 *
 * Two indexed reads of one small ledger row, no source/store hydration. The
 * second read belongs to the existing rail writer; both share this transaction.
 * oldestAgeMs is the window's maximum observed age, not a current backlog gauge.
 * Stale/deferred observations are skipped, not processed or succeeded work.
 */
export async function recordPipelineOutcomeWithCtx(
  ctx: MutationCtx,
  input: PipelineOutcomeInput,
): Promise<Id<"scheduledRunLedger"> | null> {
  return recordPipelineEvidenceWithCtx(ctx, { ...input, kind: "outcome" });
}

/**
 * Record dispatcher gauges without counting claims/candidates as outcomes.
 * Latest observation wins within its store/lane/window; a later outcome retains
 * these gauges. This helper reads only the scheduled-run ledger, not work rows.
 */
export async function recordPipelineBacklogWithCtx(
  ctx: MutationCtx,
  input: PipelineBacklogInput,
): Promise<Id<"scheduledRunLedger"> | null> {
  return recordPipelineEvidenceWithCtx(ctx, { ...input, kind: "backlog" });
}

async function recordPipelineEvidenceWithCtx(
  ctx: MutationCtx,
  input:
    | (PipelineOutcomeInput & { kind: "outcome" })
    | (PipelineBacklogInput & { kind: "backlog" }),
): Promise<Id<"scheduledRunLedger"> | null> {
  try {
    if (!Number.isFinite(input.now)) throw new Error("Invalid evidence time");
    const cronFamily = PIPELINE_CRON_FAMILY_BY_LANE[input.lane];
    const scope = input.storeId ? "store" : "system";
    const window = resolveScheduledWindow({ cronFamily, now: input.now });
    const runKey = buildScheduledRunKey({
      cronFamily,
      scheduledWindowStartAt: window.scheduledWindowStartAt,
      scope,
      storeId: input.storeId,
    });
    const existing = await ctx.db
      .query("scheduledRunLedger")
      .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
      .first();
    const prior = existing?.snapshotCounts;
    const outcome = input.kind === "outcome" ? input.outcome : undefined;
    const counts = {
      applied: boundedCount(
        (prior?.applied ?? 0) + Number(outcome === "applied"),
      ),
      blocked: boundedCount(
        (prior?.blocked ?? 0) + Number(outcome === "blocked"),
      ),
      failed: boundedCount((prior?.failed ?? 0) + Number(outcome === "failed")),
      stale: boundedCount((prior?.stale ?? 0) + Number(outcome === "stale")),
      deferred: boundedCount(
        (prior?.deferred ?? 0) + Number(outcome === "deferred"),
      ),
    };
    const latestBacklog: Record<string, number> =
      input.kind === "backlog" &&
      (prior?.backlogObservedAt === undefined ||
        input.now >= prior.backlogObservedAt)
        ? {
            backlogEligibleSampleCount: boundedCount(input.eligibleSampleCount),
            backlogOldestAgeMs: boundedCount(input.oldestAgeMs),
            backlogSaturated: Number(input.saturated === true),
            backlogObservedAt: input.now,
          }
        : prior?.backlogObservedAt !== undefined
          ? {
              backlogEligibleSampleCount: boundedCount(
                prior.backlogEligibleSampleCount,
              ),
              backlogOldestAgeMs: boundedCount(prior.backlogOldestAgeMs),
              backlogSaturated: Number(prior.backlogSaturated === 1),
              backlogObservedAt: boundedCount(prior.backlogObservedAt),
            }
          : {};
    const processedCount = boundedCount(
      counts.applied + counts.blocked + counts.failed,
    );
    const skippedCount = boundedCount(counts.stale + counts.deferred);
    return await recordScheduledRunEvidenceWithCtx(ctx, {
      cronFamily,
      now: Math.max(input.now, existing?.updatedAt ?? input.now),
      scope,
      visibility: "support",
      storeId: input.storeId,
      outcome: ledgerOutcome(counts),
      candidateCount: boundedCount(processedCount + skippedCount),
      processedCount,
      succeededCount: counts.applied,
      failedCount: counts.failed,
      skippedCount,
      sourceSubjectType: "reports_pipeline_work",
      snapshotCounts: {
        ...counts,
        ...Object.fromEntries(
          TERMINAL_DISPOSITIONS.flatMap((disposition) => {
            const key = `terminal_${disposition}`;
            const increment = Number(
              input.kind === "outcome" &&
                input.outcome === "applied" &&
                input.terminalDisposition === disposition,
            );
            return prior?.[key] !== undefined || increment
              ? [[key, boundedCount((prior?.[key] ?? 0) + increment)]]
              : [];
          }),
        ),
        saturationCount: boundedCount(
          (prior?.saturationCount ?? 0) +
            Number(input.kind === "outcome" && input.saturated === true),
        ),
        oldestAgeMs: Math.max(
          boundedCount(prior?.oldestAgeMs),
          boundedCount(input.kind === "outcome" ? input.oldestAgeMs : 0),
        ),
        ...latestBacklog,
      },
      ...(counts.failed > 0
        ? {
            error: {
              code: "reports_pipeline_failed",
              message: "Reports pipeline work failed.",
            },
          }
        : {}),
    });
  } catch {
    // Evidence is observational. Never leak source exception text or fail the
    // business outcome because the support ledger is temporarily unavailable.
    console.error(
      "[REPORTS-PIPELINE] Scheduled evidence could not be recorded.",
    );
    return null;
  }
}
