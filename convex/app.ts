import { auth } from "./auth";
import { query } from "./_generated/server";
import { User } from "../types";
import { getAuthUserId } from "@convex-dev/auth/server";

export const getCurrentUser = query({
  args: {},
  handler: async (ctx): Promise<User | undefined> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return;
    }

    const user = await ctx.db.get(userId);

    if (!user) {
      return;
    }

    return user;
  },
});
