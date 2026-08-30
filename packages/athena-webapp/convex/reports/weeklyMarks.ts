import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type {
  ReportWeekAmendmentPosture,
  ReportWeekLifecyclePosture,
} from "../../shared/reportsContract";
import { enqueueReportWork } from "./pipelineWork";
import { readPipelineControl } from "./pipelineControl";

export type WeeklyAcceptanceIntent = NonNullable<
  Doc<"reportDirtyWeek">["intent"]
>;
/** Folded dates carried on one marker. Bounded: two frames of daily work. */
export const WEEKLY_MARK_FOLDED_DATE_LIMIT = 16;

/** Atomic source handoff; this leaf must never import folds or ingress modules. */
export async function markWeekDirty(
  ctx: MutationCtx,
  storeId: Id<"store">,
  reason: Doc<"reportDirtyWeek">["reason"],
  now: number,
  opts?: {
    acceptanceBlockedReason?: Doc<"reportDirtyWeek">["acceptanceBlockedReason"];
    foldedDates?: readonly string[];
    intent?: WeeklyAcceptanceIntent;
  },
): Promise<void> {
  // Dual handoff before activation; exact work replaces the lossy singleton
  // once active. Schedule resolution is deliberately outside this producer.
  await enqueueReportWork(ctx, { storeId, kind: "current" }, now);
  for (const operatingDate of new Set(opts?.foldedDates ?? [])) {
    await enqueueReportWork(
      ctx,
      { storeId, kind: "resolve-week-date", operatingDate },
      now,
    );
  }
  if (opts?.intent)
    await enqueueReportWork(
      ctx,
      { storeId, kind: "accept", ...opts.intent },
      now,
    );
  if ((await readPipelineControl(ctx, storeId))?.mode === "active") return;
  const current = await ctx.db
    .query("reportWeekCurrent")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();
  if (current && current.availability !== "unavailable") {
    const lifecyclePosture: ReportWeekLifecyclePosture =
      current.acceptedBaselineId
        ? (current.closePosture?.status ?? "accepted")
        : "materializing";
    const amendmentPosture: ReportWeekAmendmentPosture =
      current.acceptedBaselineId ? "pending_recompute" : "none";
    await ctx.db.patch("reportWeekCurrent", current._id, {
      lifecyclePosture,
      amendmentPosture,
    });
    if (current.acceptedBaselineId)
      await ctx.db.patch("reportWeekAccepted", current.acceptedBaselineId, {
        lifecyclePosture,
        amendmentPosture,
      });
  }
  const existing = await ctx.db
    .query("reportDirtyWeek")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();
  const foldedDates = [
    ...new Set([
      ...(existing?.foldedDates ?? []),
      ...(opts?.foldedDates ?? []),
    ]),
  ]
    .sort()
    .slice(-WEEKLY_MARK_FOLDED_DATE_LIMIT);
  const intent = existing?.intent ?? opts?.intent;
  const acceptanceBlockedReason =
    opts?.acceptanceBlockedReason ??
    (intent ? undefined : existing?.acceptanceBlockedReason);
  if (existing) {
    await ctx.db.patch("reportDirtyWeek", existing._id, {
      reason,
      markedAt: now,
      intent,
      acceptanceBlockedReason,
      ...(foldedDates.length > 0 ? { foldedDates } : {}),
    });
    return;
  }
  await ctx.db.insert("reportDirtyWeek", {
    storeId,
    reason,
    markedAt: now,
    ...(intent ? { intent } : {}),
    ...(acceptanceBlockedReason ? { acceptanceBlockedReason } : {}),
    ...(foldedDates.length > 0 ? { foldedDates } : {}),
  });
}
