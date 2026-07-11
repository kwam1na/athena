import type { MutationCtx } from "../_generated/server";

export async function consumeWalkthroughBudget(
  ctx: MutationCtx,
  partition: string,
  windowStart: number,
  limit: number,
) {
  const counter = await ctx.db
    .query("walkthroughBudgetCounter")
    .withIndex("by_partition_and_windowStart", (q) =>
      q.eq("partition", partition).eq("windowStart", windowStart),
    )
    .unique();
  if ((counter?.count ?? 0) >= limit) return false;
  if (counter) {
    await ctx.db.patch("walkthroughBudgetCounter", counter._id, {
      count: counter.count + 1,
    });
  } else {
    await ctx.db.insert("walkthroughBudgetCounter", {
      partition,
      windowStart,
      count: 1,
    });
  }
  return true;
}
