import type {
  DelegatedAuthorityOutcome,
  DelegatedAuthorityPort,
} from "../operationAdmission/types";
import { delegatedReadIntentsForRole } from "../platform/readIntentCatalog";
import { isSharedDemoEnabled } from "./config";
import { isSharedDemoReadIntentAllowed } from "./policy";

/**
 * Shared-demo delegated authority port.
 *
 * Mirrors `createSharedDemoReadOperationAdapter` for a delegated run: the
 * server-owned demo principal must still exist for the pinned operator, the
 * demo must be enabled in this environment, the admission session must not
 * have expired, and the run's scope must be the principal's own store and
 * organization. Held read intents are the role-derived set intersected with
 * `SHARED_DEMO_ALLOWED_READ_INTENTS`, so a demo run can never observe more
 * than a demo visitor can through the public rail.
 */
export function createSharedDemoDelegatedAuthorityPort(options: {
  environment?: Record<string, string | undefined>;
} = {}): DelegatedAuthorityPort {
  return {
    kind: "shared_demo",
    resolve: async (ctx, request): Promise<DelegatedAuthorityOutcome> => {
      if (!request.operator.authUserId) {
        return { kind: "denied", reason: "principal_missing", message: "The demo principal is not recorded on this run." };
      }
      const principal = await ctx.db
        .query("sharedDemoPrincipal")
        .withIndex("by_authUserId", (q) => q.eq("authUserId", request.operator.authUserId!))
        .unique();
      if (!principal || principal.athenaUserId !== request.operator.athenaUserId) {
        return { kind: "denied", reason: "principal_missing", message: "The demo session is no longer recognized." };
      }
      if (!isSharedDemoEnabled(options.environment ?? process.env)) {
        return { kind: "denied", reason: "demo_disabled", message: "The demo is unavailable in this environment." };
      }
      if (principal.admissionExpiresAt <= request.now) {
        return { kind: "denied", reason: "session_expired", message: "The demo session has expired. Open the demo again." };
      }
      if (principal.storeId !== request.storeId || principal.organizationId !== request.organizationId) {
        return { kind: "denied", reason: "store_out_of_scope", message: "This view isn't available in the demo." };
      }
      const membership = await ctx.db
        .query("organizationMember")
        .withIndex("by_organizationId_userId", (q) =>
          q.eq("organizationId", request.organizationId).eq("userId", request.operator.athenaUserId),
        )
        .first();
      const membershipRole = membership?.role ?? "pos_only";
      return {
        kind: "authorized",
        authority: {
          operator: request.operator,
          organizationId: request.organizationId,
          storeId: request.storeId,
          membershipRole,
          operationalRoles: [...(membership?.operationalRoles ?? [])],
          heldReadIntents: delegatedReadIntentsForRole(membershipRole).filter((intent) =>
            isSharedDemoReadIntentAllowed(intent),
          ),
        },
      };
    },
  };
}
