import { auth } from "./auth";
import { query } from "./_generated/server";
import { User } from "../types";
import { getAuthUserId } from "@convex-dev/auth/server";

export const getCurrentUser = query({
  args: {},
  handler: async (ctx): Promise<User | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const user = await ctx.db.get(userId);

    if (!user) {
      return null;
    }

    return user;
  },
});

export const getCurrentUserIdentity = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity?.email) {
      return null;
    }

    return {
      email: identity.email,
    };
  },
});
