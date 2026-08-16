import { auth } from "./auth";
import { query } from "./_generated/server";
import { User } from "../types";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  getCurrentUserIdentityReadDefinition,
  getCurrentUserReadDefinition,
} from "./operationAdmission/domains/u9_platform_readDefinitions";
import { admitPublicQuery } from "./platform/operationAdmission";

/**
 * Both reads are admitted with `public: "admit"` on purpose: they are the
 * webapp's bootstrap "who am I" calls, issued on every page load including
 * signed-out ones, and their contract is to answer `null` rather than to deny.
 * Admission adds the actor/intent boundary around that contract; it does not
 * change the answer for any actor.
 */
export const getCurrentUser = query({
  args: {},
  handler: admitPublicQuery(
    getCurrentUserReadDefinition,
    async (ctx, _args: Record<string, never>): Promise<User | null> => {
      const userId = await getAuthUserId(ctx);
      if (!userId) {
        return null;
      }

      const user = await ctx.db.get("users", userId);

      if (!user) {
        return null;
      }

      return user;
    },
  ),
});

export const getCurrentUserIdentity = query({
  args: {},
  handler: admitPublicQuery(
    getCurrentUserIdentityReadDefinition,
    async (ctx, _args: Record<string, never>) => {
      const identity = await ctx.auth.getUserIdentity();

      if (!identity?.email) {
        return null;
      }

      return {
        email: identity.email,
      };
    },
  ),
});
