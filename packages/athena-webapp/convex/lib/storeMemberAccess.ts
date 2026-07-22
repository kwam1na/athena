import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type {
  OperationMutationCtx,
  OperationQueryCtx,
} from "../operationAdmission/types";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "./athenaUserAuth";

type StoreMemberAccessCtx =
  Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;
type OrganizationMemberRole = "full_admin" | "pos_only";

export async function requireStoreMemberAccessWithCtx(
  ctx: StoreMemberAccessCtx,
  args: {
    allowedRoles: OrganizationMemberRole[];
    demoAccess?: unknown;
    failureMessage: string;
    storeId: Id<"store">;
  },
) {
  const operationAdmission = (
    ctx as Partial<OperationMutationCtx | OperationQueryCtx>
  ).operationAdmission;
  const admittedActor = operationAdmission?.actor;
  const demoActor =
    admittedActor?.kind === "shared_demo" ? admittedActor : null;

  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    throw new Error("Store not found.");
  }

  const athenaUser =
    demoActor !== null
      ? await ctx.db.get("athenaUser", demoActor.athenaUserId)
      : await requireAuthenticatedAthenaUserWithCtx(ctx);
  if (!athenaUser) {
    throw new Error("Sign in again to continue.");
  }

  const membership = await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: args.allowedRoles,
    failureMessage: args.failureMessage,
    organizationId: store.organizationId,
    userId: athenaUser._id,
  });

  return { athenaUser, demoActor, membership, store };
}
