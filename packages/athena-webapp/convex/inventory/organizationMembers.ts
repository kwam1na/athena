import { query } from "../_generated/server";
import { v } from "convex/values";

const entity = "organizationMember";

export const getAll = query({
  args: {
    organizationId: v.id("organization"),
  },
  handler: async (ctx, args) => {
    const members = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("organizationId"), args.organizationId))
      .collect();

    return await Promise.all(
      members.map((member) => ctx.db.get(member.userId))
    );
  },
});
