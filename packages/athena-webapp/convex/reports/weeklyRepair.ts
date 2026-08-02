import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { rebuildCurrentWeek } from "./weekly";

export type RepairCurrentWeeklyProjectionResult = {
  outcome: "rebuilt" | "unavailable";
};

/**
 * Repair the live weekly projection from already-folded report days.
 *
 * This deliberately has no path to `reportFact` or `reportWeekAccepted`:
 * repair replaces only disposable current projection state. Accepted history
 * remains evidence and must never be manufactured by maintenance work.
 */
export async function repairCurrentWeeklyProjectionWithCtx(
  ctx: MutationCtx,
  args: { now?: number; storeId: Id<"store"> },
): Promise<RepairCurrentWeeklyProjectionResult> {
  const outcome = await rebuildCurrentWeek(
    ctx,
    args.storeId,
    args.now ?? Date.now(),
  );
  return { outcome };
}

export const repairCurrentWeeklyProjection = internalMutation({
  args: {
    now: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: repairCurrentWeeklyProjectionWithCtx,
});
