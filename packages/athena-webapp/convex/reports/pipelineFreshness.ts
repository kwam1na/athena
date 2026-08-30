import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { readPipelineControl } from "./pipelineControl";

/** Clearing an epoch or its work queue does not complete a store's recovery. */
export function isPipelineRecoveryPending(
  control:
    | Pick<
        Doc<"reportPipelineControl">,
        "mode" | "hasActivated" | "activeRollupEpoch"
      >
    | null
    | undefined,
): boolean {
  return (
    control?.mode === "paused" ||
    (control?.mode === "shadow" &&
      Boolean(control.hasActivated || control.activeRollupEpoch))
  );
}

/** Compact indexed probes; never certify a snapshot ahead of its inputs. */
export async function overviewProjectionStatus(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
): Promise<"ready" | "pending" | "blocked"> {
  const control = await readPipelineControl(ctx, storeId);
  if (isPipelineRecoveryPending(control)) return "pending";
  const work = await ctx.db
    .query("reportPipelineWork")
    .withIndex("by_storeId_kind_createdAt", (q) =>
      q.eq("storeId", storeId).eq("kind", "overview"),
    )
    .first();
  const day = await ctx.db
    .query("reportDirtyDay")
    .withIndex("by_storeId_eligibleAt", (q) => q.eq("storeId", storeId))
    .first();
  if (
    work?.status === "blocked" ||
    day?.lastFailure ||
    day?.reason === "fact_cap_exceeded"
  )
    return "blocked";
  return work || day ? "pending" : "ready";
}
