import { v } from "convex/values";
import { query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { getAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import {
  getAuthenticatedUserReadDefinition,
  getUserByIdReadDefinition,
} from "../operationAdmission/domains/reports_readDefinitions";
import { admitPublicQuery } from "../platform/operationAdmission";
import type { OperationQueryCtx } from "../operationAdmission/types";

export function isExpiredSharedDemoSessionError(error: unknown) {
  return (
    error instanceof Error &&
    error.message ===
      "The demo session has expired. Open the demo again."
  );
}

/**
 * The identity probe (`useAuth`).
 *
 * The shared-demo principal used to be mapped onto its Athena user here by
 * passing `{ sharedDemoCapability: "reports.read" }` into the generic auth
 * helper. That bridge is retired: the demo actor is admitted by the rail and
 * arrives as `ctx.operationAdmission.actor`, which the helper reads for every
 * actor kind, so the demo workspace resolves the same user with no capability
 * argument threaded through the call.
 *
 * The expired-demo-session catch stays, and moved OUTSIDE the wrapper on
 * purpose: an expired principal used to surface from
 * `getSharedDemoActorWithCtx` inside the handler, and now surfaces from the
 * shared-demo adapter during admission. Either way this one surface must read
 * as "signed out" rather than throw, or the shell cannot render the screen
 * that would let the visitor start a fresh demo.
 */
const admitGetAuthenticatedUser = admitPublicQuery(
  getAuthenticatedUserReadDefinition,
  async (ctx: OperationQueryCtx) => getAuthenticatedAthenaUserWithCtx(ctx),
);

export const getAuthenticatedUser = query({
  args: {},
  handler: async (ctx, args: Record<string, never>) => {
    try {
      return await admitGetAuthenticatedUser(ctx, args);
    } catch (error) {
      if (isExpiredSharedDemoSessionError(error)) {
        return null;
      }
      throw error;
    }
  },
});

export const getUserById = query({
  args: { id: v.union(v.string(), v.null()) },
  handler: admitPublicQuery(
    getUserByIdReadDefinition,
    async (ctx: OperationQueryCtx, args: { id: string | null }) => {
      if (!args.id) {
        return null;
      }

      try {
        const res = await ctx.db.get("athenaUser", args.id as Id<"athenaUser">);

        return res;
      } catch (e) {
        console.error(e);
        return null;
      }
    },
  ),
});
