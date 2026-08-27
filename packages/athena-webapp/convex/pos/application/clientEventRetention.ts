import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { internalMutation } from "../../_generated/server";

const DAY_MS = 86_400_000;
export const POS_CLIENT_EVENT_RETENTION_MS = 30 * DAY_MS;
export const POS_CLIENT_EVENT_RETENTION_BATCH_SIZE = 100;
const POS_CLIENT_EVENT_RETENTION_MAX_BATCH_SIZE = 200;

export const cleanupBatch = internalMutation({
  args: {
    fixedNow: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const fixedNow = args.fixedNow ?? Date.now();
    const limit = Math.min(
      POS_CLIENT_EVENT_RETENTION_MAX_BATCH_SIZE,
      Math.max(1, args.limit ?? POS_CLIENT_EVENT_RETENTION_BATCH_SIZE),
    );
    const cutoff = fixedNow - POS_CLIENT_EVENT_RETENTION_MS;
    const expired = await ctx.db
      .query("posClientEvent")
      .withIndex("by_receivedAt", (q) => q.lt("receivedAt", cutoff))
      .take(limit);

    for (const event of expired) {
      await ctx.db.delete("posClientEvent", event._id);
    }

    const hasMore = expired.length === limit;
    if (hasMore) {
      await ctx.scheduler.runAfter(
        0,
        internal.pos.application.clientEventRetention.cleanupBatch,
        { fixedNow, limit },
      );
    }

    return { deleted: expired.length, fixedNow, hasMore };
  },
});
