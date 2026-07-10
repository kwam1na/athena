import type { FunctionReference } from "convex/server";
import type { MutationCtx } from "../_generated/server";

/**
 * Reporting work is durable before it is scheduled. A scheduler failure must
 * leave operational mutations successful so maintenance can resume pending work.
 */
export async function scheduleReportingWorkBestEffort(
  ctx: MutationCtx,
  reference: FunctionReference<"mutation" | "action", "internal">,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (!ctx.scheduler || typeof ctx.scheduler.runAfter !== "function") {
    return false;
  }
  try {
    await ctx.scheduler.runAfter(0, reference, args);
    return true;
  } catch (error) {
    console.warn("[reporting] Deferred work could not be scheduled", {
      error: error instanceof Error ? error.message : "unknown scheduler error",
    });
    return false;
  }
}
