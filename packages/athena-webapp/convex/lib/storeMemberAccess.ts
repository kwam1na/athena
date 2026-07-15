import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  requireSharedDemoStoreCapabilityIfApplicable,
  requireSharedDemoStoreReadIfApplicable,
} from "../sharedDemo/actor";
import type { SharedDemoCapability } from "../sharedDemo/policy";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "./athenaUserAuth";

type StoreMemberAccessCtx =
  | Pick<QueryCtx, "auth" | "db">
  | Pick<MutationCtx, "auth" | "db">;
type OrganizationMemberRole = "full_admin" | "pos_only";
type DemoAccess =
  | { kind: "read" }
  | { capability: SharedDemoCapability; kind: "capability" };

export async function requireStoreMemberAccessWithCtx(
  ctx: StoreMemberAccessCtx,
  args: {
    allowedRoles: OrganizationMemberRole[];
    demoAccess: DemoAccess;
    failureMessage: string;
    storeId: Id<"store">;
  },
) {
  const demoActor =
    args.demoAccess.kind === "read"
      ? await requireSharedDemoStoreReadIfApplicable(ctx, args.storeId)
      : await requireSharedDemoStoreCapabilityIfApplicable(
          ctx,
          args.demoAccess.capability,
          args.storeId,
        );

  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    throw new Error("Store not found.");
  }

  const athenaUser = demoActor
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
