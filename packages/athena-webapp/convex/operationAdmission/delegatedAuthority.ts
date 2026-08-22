import { delegatedReadIntentsForRole } from "../platform/readIntentCatalog";
import type {
  DelegatedAuthorityOutcome,
  DelegatedAuthorityPort,
} from "./types";

/**
 * Normal-user delegated authority port (rail core; imports nothing outside
 * the rail and the catalogs).
 *
 * Re-reads, at call time, exactly the facts the public read rail and its
 * domain handlers already rely on: the Athena user still exists, the store
 * still belongs to the organization the run was opened in, and the operator
 * still holds an `organizationMember` row there. The held read intents are
 * derived from that membership's role through the catalog's delegation
 * annotation. It never consults `ctx.auth`: the operator identity was
 * established by the public rail when the turn was admitted and pinned on the
 * grant; this port answers "do they STILL hold it", fail closed.
 */
export function createNormalUserDelegatedAuthorityPort(): DelegatedAuthorityPort {
  return {
    kind: "normal_user",
    resolve: async (ctx, request): Promise<DelegatedAuthorityOutcome> => {
      const athenaUser = await ctx.db.get("athenaUser", request.operator.athenaUserId);
      if (!athenaUser) {
        return { kind: "denied", reason: "operator_unknown", message: "The operator no longer exists." };
      }
      const store = await ctx.db.get("store", request.storeId);
      if (!store) {
        return { kind: "denied", reason: "store_missing", message: "The store no longer exists." };
      }
      if (store.organizationId !== request.organizationId) {
        return {
          kind: "denied",
          reason: "store_out_of_scope",
          message: "The store is no longer part of the organization this run was opened in.",
        };
      }
      const membership = await ctx.db
        .query("organizationMember")
        .withIndex("by_organizationId_userId", (q) =>
          q.eq("organizationId", request.organizationId).eq("userId", request.operator.athenaUserId),
        )
        .first();
      if (!membership) {
        return {
          kind: "denied",
          reason: "membership_revoked",
          message: "The operator is no longer a member of this organization.",
        };
      }
      return {
        kind: "authorized",
        authority: {
          operator: request.operator,
          organizationId: request.organizationId,
          storeId: request.storeId,
          membershipRole: membership.role,
          operationalRoles: [...(membership.operationalRoles ?? [])],
          heldReadIntents: delegatedReadIntentsForRole(membership.role),
        },
      };
    },
  };
}
