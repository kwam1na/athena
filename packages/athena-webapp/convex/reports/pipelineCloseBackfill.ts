import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { markDirty } from "./marks";
import {
  enqueueReportWork,
  reportWorkKey,
  type ReportWorkInput,
} from "./pipelineWork";
import {
  CLOSE_EVIDENCE_SCHEMA_VERSION,
  isActiveAcceptedClose,
  lifecycleSignature,
  normalizeCloseEvidence,
  publishCloseLifecycleWithCtx,
  readCloseEvidenceWithCtx,
} from "./closeEvidence";

export type CloseWeeklyBackfillPhase = "closes" | "days" | "legacy-week";
export type CloseWeeklyBackfillPage = {
  nextPhase: CloseWeeklyBackfillPhase;
  nextCursor: string | null;
  done: boolean;
  processed: number;
};

/** Replay a checkpoint without stealing a currently leased work generation. */
async function ensureWork(
  ctx: MutationCtx,
  input: ReportWorkInput,
  now: number,
) {
  const existing = await ctx.db
    .query("reportPipelineWork")
    .withIndex("by_storeId_workKey", (q) =>
      q.eq("storeId", input.storeId).eq("workKey", reportWorkKey(input)),
    )
    .unique();
  if (existing) {
    if (
      input.kind === "accept" &&
      (existing.kind !== "accept" ||
        existing.cutoffObservedAt !== input.cutoffObservedAt)
    )
      throw new Error("weekly_backfill_cutoff_conflict");
    return;
  }
  await enqueueReportWork(ctx, input, now);
}

async function backfillClosePage(
  ctx: MutationCtx,
  args: { storeId: Id<"store">; cursor: string | null; now: number },
): Promise<CloseWeeklyBackfillPage> {
  const page = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", args.storeId))
    .order("asc")
    .paginate({ cursor: args.cursor, numItems: 1 });
  for (const close of page.page) {
    const header = await ctx.db
      .query("reportCloseEvidence")
      .withIndex("by_closeId", (q) => q.eq("closeId", close._id))
      .unique();
    if (header && header.storeId !== args.storeId)
      throw new Error("weekly_backfill_ownership_mismatch");
    if (
      !header ||
      header.sourceSignature !== lifecycleSignature(close) ||
      header.schemaVersion !== CLOSE_EVIDENCE_SCHEMA_VERSION
    ) {
      await publishCloseLifecycleWithCtx(ctx, close, args.now, {
        forceRepair:
          header !== null &&
          header.schemaVersion !== CLOSE_EVIDENCE_SCHEMA_VERSION,
      });
    } else if (header.publishedGeneration !== header.expectedGeneration) {
      await ensureWork(
        ctx,
        { storeId: args.storeId, kind: "close-evidence", closeId: close._id },
        args.now,
      );
    }
    // Historical source coverage must not depend on a surviving derived day
    // or dirty marker. Preserve any existing lease/generation on page replay.
    const dirty = await ctx.db
      .query("reportDirtyDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", args.storeId).eq("operatingDate", close.operatingDate),
      )
      .unique();
    if (!dirty)
      await markDirty(
        ctx,
        args.storeId,
        close.operatingDate,
        "fold_version_bump",
        args.now,
      );
    await ensureWork(
      ctx,
      {
        storeId: args.storeId,
        kind: "resolve-week-date",
        operatingDate: close.operatingDate,
      },
      args.now,
    );
  }
  return {
    nextPhase: page.isDone ? "days" : "closes",
    nextCursor: page.isDone ? null : page.continueCursor,
    done: false,
    processed: page.page.length,
  };
}

async function backfillDayPage(
  ctx: MutationCtx,
  args: { storeId: Id<"store">; cursor: string | null; now: number },
): Promise<CloseWeeklyBackfillPage> {
  // A reportDay may carry a large paymentMixState: preserve the one-row budget.
  const page = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", args.storeId))
    .order("asc")
    .paginate({ cursor: args.cursor, numItems: 1 });
  for (const day of page.page)
    await ensureWork(
      ctx,
      {
        storeId: args.storeId,
        kind: "resolve-week-date",
        operatingDate: day.operatingDate,
      },
      args.now,
    );
  return {
    nextPhase: page.isDone ? "legacy-week" : "days",
    nextCursor: page.isDone ? null : page.continueCursor,
    done: false,
    processed: page.page.length,
  };
}

/** Parent migration owns control/epoch/fence admission and persists the returned
 * phase/cursor in THIS transaction. No wrapper may checkpoint separately.
 * Additive in shadow: never writes accepted baselines or emits notifications.
 */
export async function backfillCloseWeeklyPageWithCtx(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    phase: CloseWeeklyBackfillPhase;
    cursor: string | null;
    now: number;
  },
): Promise<CloseWeeklyBackfillPage> {
  if (args.phase === "closes") return backfillClosePage(ctx, args);
  if (args.phase === "days") return backfillDayPage(ctx, args);
  const legacy = await ctx.db
    .query("reportDirtyWeek")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .unique();
  if (legacy?.intent)
    await ensureWork(
      ctx,
      { storeId: args.storeId, kind: "accept", ...legacy.intent },
      args.now,
    );
  for (const operatingDate of new Set(legacy?.foldedDates ?? []))
    await ensureWork(
      ctx,
      { storeId: args.storeId, kind: "resolve-week-date", operatingDate },
      args.now,
    );
  await ensureWork(ctx, { storeId: args.storeId, kind: "current" }, args.now);
  return {
    nextPhase: "legacy-week",
    nextCursor: null,
    done: true,
    processed: Number(Boolean(legacy)),
  };
}

type CoverageIssue = {
  closeId: Id<"dailyClose">;
  reason:
    | "missing"
    | "pending"
    | "source_changed"
    | "ownership_mismatch"
    | "invalid_evidence"
    | "capacity_exceeded";
};
/** Bounded source/companion parity, not a production bandwidth measurement.
 * Parent must fence the entire paged coverage run with its source watermark;
 * a later source lifecycle change invalidates this page's conclusion.
 */
export async function verifyCloseCoveragePageWithCtx(
  ctx: QueryCtx,
  args: { storeId: Id<"store">; cursor: string | null },
) {
  const page = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", args.storeId))
    .order("asc")
    .paginate({ cursor: args.cursor, numItems: 1 });
  const issues: CoverageIssue[] = [];
  for (const close of page.page) {
    const header = await ctx.db
      .query("reportCloseEvidence")
      .withIndex("by_closeId", (q) => q.eq("closeId", close._id))
      .unique();
    let reason: CoverageIssue["reason"] | undefined;
    if (!header) reason = "missing";
    else if (header.storeId !== args.storeId) reason = "ownership_mismatch";
    else if (
      header.sourceSignature !== lifecycleSignature(close) ||
      header.schemaVersion !== CLOSE_EVIDENCE_SCHEMA_VERSION ||
      isActiveAcceptedClose(header) !== isActiveAcceptedClose(close)
    )
      reason = "source_changed";
    else if (header.publishedGeneration !== header.expectedGeneration)
      reason = "pending";
    else {
      const read = await readCloseEvidenceWithCtx(ctx, args.storeId, close._id);
      const normalized = normalizeCloseEvidence(close);
      if (normalized.capacityExceeded) reason = "capacity_exceeded";
      else if (
        read.status !== "ready" ||
        header.digest !== normalized.digest ||
        header.itemCount !== normalized.items.length ||
        header.cashVarianceMinor !== normalized.cashVarianceMinor ||
        header.transactionCount !== normalized.transactionCount ||
        header.expenseTotal !== normalized.expenseTotal ||
        Object.entries(normalized.lanes).some(
          ([lane, value]) =>
            header.lanes[lane as keyof typeof header.lanes] !== value,
        )
      )
        reason = "invalid_evidence";
    }
    if (reason) issues.push({ closeId: close._id, reason });
  }
  return {
    nextCursor: page.isDone ? null : page.continueCursor,
    done: page.isDone,
    checked: page.page.length,
    issues,
  };
}
