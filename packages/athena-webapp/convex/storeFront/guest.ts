import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
} from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { deleteGuestOperationDefinition } from "../operationAdmission/domains/u6_storefrontCustomer_definitions";
import {
  getAllGuestsReadDefinition,
  getReturningVisitorsForDayReadDefinition,
  getUniqueVisitorsForDayReadDefinition,
  getUniqueVisitorsReadDefinition,
} from "../operationAdmission/domains/u6_storefrontCustomer_readDefinitions";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import {
  assertCustomerOwnsStoreIfPropagated,
  customerOwnerActorId,
  customerOwnerValidator,
  denyCustomerOwnership,
} from "./customerOwnership";

const entity = "guest";
const MAX_GUESTS = 5000;
const MAX_ANALYTICS_VISITORS = 2000;

export const getAll = query({
  args: {},
  handler: admitPublicQuery(getAllGuestsReadDefinition, async (ctx) => {
    return await ctx.db.query(entity).take(MAX_GUESTS);
  }),
});

export const getById = internalQuery({
  args: {
    id: v.id(entity),
    owner: v.optional(customerOwnerValidator),
  },
  handler: async (ctx, args) => {
    if (
      args.owner &&
      String(args.id) !== String(customerOwnerActorId(args.owner))
    ) {
      denyCustomerOwnership();
    }
    return await ctx.db.get("guest", args.id);
  },
});

export const getByMarker = internalQuery({
  args: {
    marker: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const guest = await ctx.db
      .query(entity)
      .withIndex("by_marker", (q) => q.eq("marker", args.marker))
      .first();

    return guest;
  },
});

/**
 * `storeId` is REQUIRED here, which is the write half of the guest-store
 * tightening this unit ships.
 *
 * A guest row without a store cannot be clamped, so the storefront adapter
 * treats it as a terminal denial — a guest created storeless is a shopper who
 * can never be admitted again. Refusing at creation is what stops the backfill
 * from having to chase new rows, and the store is never defaulted: the caller
 * must know which storefront the visitor arrived at.
 *
 * Wave B2 (U10) updates the one caller that does not pass it today,
 * `POST /guests` in `http/domains/customerChannel/routes/guest.ts`, to pass the
 * store resolved from the request's `store_id` claim.
 */
export const create = internalMutation({
  args: {
    marker: v.optional(v.string()),
    creationOrigin: v.optional(v.string()),
    storeId: v.id("store"),
    organizationId: v.optional(v.id("organization")),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, {
      marker: args.marker,
      creationOrigin: args.creationOrigin,
      storeId: args.storeId,
      organizationId: args.organizationId,
    });

    return ctx.db.get("guest", id);
  },
});

async function deleteGuestWithCtx(ctx: MutationCtx, id: Id<"guest">) {
  await ctx.db.delete("guest", id);
  return { message: "Guest deleted" };
}

export const deleteGuest = mutation({
  args: {
    id: v.id(entity),
  },
  handler: admitPublicMutation(
    deleteGuestOperationDefinition,
    async (ctx, args: { id: Id<"guest"> }) => deleteGuestWithCtx(ctx, args.id),
  ),
});

export const update = internalMutation({
  args: {
    id: v.id(entity),
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    owner: v.optional(customerOwnerValidator),
  },
  handler: async (ctx, args) => {
    if (args.owner) {
      // A guest may only ever patch their own row: the id in the path is
      // checked against the admitted claim, not merely trusted.
      if (String(args.id) !== String(customerOwnerActorId(args.owner))) {
        denyCustomerOwnership();
      }
      const guest = await ctx.db.get("guest", args.id);
      assertCustomerOwnsStoreIfPropagated(args.owner, guest?.storeId);
    }

    const updates: Record<string, any> = {};
    if (args.email) {
      updates.email = args.email;
    }
    if (args.firstName) {
      updates.firstName = args.firstName;
    }
    if (args.lastName) {
      updates.lastName = args.lastName;
    }
    if (args.phoneNumber) {
      updates.phoneNumber = args.phoneNumber;
    }
    await ctx.db.patch("guest", args.id, updates);
    return await ctx.db.get("guest", args.id);
  },
});

export const getUniqueVisitorsForDay = query({
  args: {
    storeId: v.id("store"),
    startTimeMs: v.number(),
    endTimeMs: v.number(),
  },
  handler: admitPublicQuery(
    getUniqueVisitorsForDayReadDefinition,
    async (
      ctx,
      args: { storeId: Id<"store">; startTimeMs: number; endTimeMs: number },
    ) => {
      const uniqueVisitors = await ctx.db
        .query(entity)
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .filter((q) =>
          q.and(
            q.gte(q.field("_creationTime"), args.startTimeMs),
            q.lt(q.field("_creationTime"), args.endTimeMs)
          )
        )
        .take(MAX_GUESTS);

      return uniqueVisitors.length;
    },
  ),
});

export const getUniqueVisitors = query({
  args: {
    storeId: v.id("store"),
    startTimeMs: v.number(),
  },
  handler: admitPublicQuery(
    getUniqueVisitorsReadDefinition,
    async (ctx, args: { storeId: Id<"store">; startTimeMs: number }) => {
      const uniqueVisitors = await ctx.db
        .query(entity)
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .filter((q) => q.gte(q.field("_creationTime"), args.startTimeMs))
        .take(MAX_GUESTS);

      return uniqueVisitors.length;
    },
  ),
});

export const getReturningVisitorsForDay = query({
  args: {
    storeId: v.id("store"),
    startTimeMs: v.number(),
    endTimeMs: v.number(),
  },
  returns: v.number(),
  handler: admitPublicQuery(
    getReturningVisitorsForDayReadDefinition,
    async (
      ctx,
      args: { storeId: Id<"store">; startTimeMs: number; endTimeMs: number },
    ) => {
    // Get all visitors with analytics activity today
    const analyticsToday = await ctx.db
      .query("analytics")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), args.startTimeMs),
          q.lt(q.field("_creationTime"), args.endTimeMs)
        )
      )
      .take(MAX_ANALYTICS_VISITORS);

    // Get unique visitor IDs from today's analytics
    const visitorIdsToday = new Set<Id<"storeFrontUser"> | Id<"guest">>();
    for (const analytic of analyticsToday) {
      if (analytic.storeFrontUserId) {
        visitorIdsToday.add(analytic.storeFrontUserId);
      }
    }

    // Count how many of these users also have analytics records from before today
    let returningVisitors = 0;
    for (const visitorId of visitorIdsToday) {
      const previousActivity = await ctx.db
        .query("analytics")
        .withIndex("by_storeFrontUserId_storeId", (q) =>
          q.eq("storeFrontUserId", visitorId).eq("storeId", args.storeId)
        )
        .filter((q) => q.lt(q.field("_creationTime"), args.startTimeMs))
        .first();

      if (previousActivity) {
        returningVisitors++;
      }
    }

    return returningVisitors;
    },
  ),
});
