import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export function readPipelineControl(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
) {
  return ctx.db
    .query("reportPipelineControl")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();
}
