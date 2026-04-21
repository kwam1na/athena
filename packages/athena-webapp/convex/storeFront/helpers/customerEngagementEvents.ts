import { Id } from "../../_generated/dataModel";
import { MutationCtx } from "../../_generated/server";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import { resolveCustomerProfileForStoreFrontActor } from "./orderOperations";

type StoreFrontActorId = Id<"storeFrontUser"> | Id<"guest">;

export type RecordStoreFrontCustomerMilestoneArgs = {
  actorUserId?: Id<"athenaUser">;
  eventType: string;
  message?: string;
  metadata?: Record<string, unknown>;
  reason?: string;
  storeFrontUserId: StoreFrontActorId;
  storeId: Id<"store">;
  subjectId: string;
  subjectLabel?: string;
  subjectType: string;
};

async function findExistingCustomerProfileId(
  ctx: MutationCtx,
  storeFrontUserId: StoreFrontActorId,
) {
  try {
    const storeFrontUser = await ctx.db.get(
      "storeFrontUser",
      storeFrontUserId as Id<"storeFrontUser">,
    );

    if (storeFrontUser) {
      const profile = await ctx.db
        .query("customerProfile")
        .withIndex("by_storeFrontUserId", (q) =>
          q.eq("storeFrontUserId", storeFrontUser._id),
        )
        .first();

      if (profile?._id) {
        return profile._id;
      }
    }
  } catch {}

  try {
    const guest = await ctx.db.get("guest", storeFrontUserId as Id<"guest">);

    if (guest) {
      const profile = await ctx.db
        .query("customerProfile")
        .withIndex("by_guestId", (q) => q.eq("guestId", guest._id))
        .first();

      if (profile?._id) {
        return profile._id;
      }
    }
  } catch {}

  return null;
}

async function getStoreOrganizationId(
  ctx: MutationCtx,
  storeId: Id<"store">,
) {
  const store = await ctx.db.get("store", storeId);
  return store?.organizationId;
}

export async function recordStoreFrontCustomerMilestone(
  ctx: MutationCtx,
  args: RecordStoreFrontCustomerMilestoneArgs,
) {
  const organizationId = (await getStoreOrganizationId(ctx, args.storeId)) ?? undefined;
  const customerProfileId =
    (await findExistingCustomerProfileId(ctx, args.storeFrontUserId)) ??
    (
      await resolveCustomerProfileForStoreFrontActor(ctx, {
        organizationId,
        storeFrontUserId: args.storeFrontUserId,
        storeId: args.storeId,
      })
    )?._id ??
    undefined;

  if (!customerProfileId) {
    return null;
  }

  return recordOperationalEventWithCtx(ctx, {
    actorUserId: args.actorUserId,
    customerProfileId,
    eventType: args.eventType,
    message: args.message,
    metadata: args.metadata,
    organizationId,
    reason: args.reason,
    storeId: args.storeId,
    subjectId: args.subjectId,
    subjectLabel: args.subjectLabel,
    subjectType: args.subjectType,
  });
}
