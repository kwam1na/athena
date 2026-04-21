import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";

import { ensureCustomerProfileFromSourcesWithCtx } from "../../../operations/customerProfiles";

type PosCustomerReadCtx = QueryCtx | MutationCtx;

export async function listActiveCustomersForStore(
  ctx: QueryCtx,
  storeId: Id<"store">,
) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Search still performs a store-scoped scan until we add a dedicated search index; bounding here would drop valid matches unpredictably.
  return ctx.db
    .query("posCustomer")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .filter((q) => q.eq(q.field("isActive"), true))
    .collect();
}

export async function getPosCustomerById(
  ctx: PosCustomerReadCtx,
  customerId: Id<"posCustomer">,
) {
  return ctx.db.get("posCustomer", customerId);
}

export async function findCustomerByEmail(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    email: string;
  },
) {
  return ctx.db
    .query("posCustomer")
    .withIndex("by_storeId_and_email", (q) =>
      q.eq("storeId", args.storeId).eq("email", args.email),
    )
    .first();
}

export async function findCustomerByPhone(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    phone: string;
  },
) {
  return ctx.db
    .query("posCustomer")
    .withIndex("by_storeId_and_phone", (q) =>
      q.eq("storeId", args.storeId).eq("phone", args.phone),
    )
    .first();
}

export async function createPosCustomer(
  ctx: MutationCtx,
  input: Omit<Doc<"posCustomer">, "_id" | "_creationTime">,
) {
  return ctx.db.insert("posCustomer", input);
}

export async function patchPosCustomer(
  ctx: MutationCtx,
  customerId: Id<"posCustomer">,
  patch: Partial<Omit<Doc<"posCustomer">, "_id" | "_creationTime">>,
) {
  await ctx.db.patch("posCustomer", customerId, patch);
}

export async function updateCustomerStats(
  ctx: MutationCtx,
  args: {
    customerId: Id<"posCustomer">;
    transactionAmount: number;
    updatedAt: number;
  },
) {
  const customer = await ctx.db.get("posCustomer", args.customerId);
  if (!customer) {
    return null;
  }

  await ctx.db.patch("posCustomer", args.customerId, {
    totalSpent: (customer.totalSpent || 0) + args.transactionAmount,
    transactionCount: (customer.transactionCount || 0) + 1,
    lastTransactionAt: args.updatedAt,
  });

  return null;
}

export async function listCompletedTransactionsForCustomer(
  ctx: QueryCtx,
  args: {
    customerId: Id<"posCustomer">;
    limit?: number;
  },
) {
  const customer = await ctx.db.get("posCustomer", args.customerId);
  if (!customer) {
    return [];
  }

  return ctx.db
    .query("posTransaction")
    .withIndex("by_storeId", (q) => q.eq("storeId", customer.storeId))
    .filter((q) =>
      q.and(
        q.eq(q.field("customerId"), args.customerId),
        q.eq(q.field("status"), "completed"),
      ),
    )
    .order("desc")
    .take(args.limit || 10);
}

export async function getStoreFrontUserById(
  ctx: PosCustomerReadCtx,
  storeFrontUserId: Id<"storeFrontUser">,
) {
  return ctx.db.get("storeFrontUser", storeFrontUserId);
}

export async function getGuestById(ctx: PosCustomerReadCtx, guestId: Id<"guest">) {
  return ctx.db.get("guest", guestId);
}

export async function findPosCustomerByStoreFrontUser(
  ctx: QueryCtx,
  storeFrontUserId: Id<"storeFrontUser">,
) {
  return ctx.db
    .query("posCustomer")
    .withIndex("by_linkedStoreFrontUserId", (q) =>
      q.eq("linkedStoreFrontUserId", storeFrontUserId),
    )
    .first();
}

export async function findStoreFrontUserByEmail(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    email: string;
  },
) {
  return ctx.db
    .query("storeFrontUser")
    .filter((q) =>
      q.and(
        q.eq(q.field("storeId"), args.storeId),
        q.eq(q.field("email"), args.email),
      ),
    )
    .first();
}

export async function findGuestByEmail(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    email: string;
  },
) {
  return ctx.db
    .query("guest")
    .filter((q) =>
      q.and(
        q.eq(q.field("storeId"), args.storeId),
        q.eq(q.field("email"), args.email),
      ),
    )
    .first();
}

export async function findStoreFrontUserByPhone(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    phone: string;
  },
) {
  return ctx.db
    .query("storeFrontUser")
    .filter((q) =>
      q.and(
        q.eq(q.field("storeId"), args.storeId),
        q.eq(q.field("phoneNumber"), args.phone),
      ),
    )
    .first();
}

export async function findGuestByPhone(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    phone: string;
  },
) {
  return ctx.db
    .query("guest")
    .filter((q) =>
      q.and(
        q.eq(q.field("storeId"), args.storeId),
        q.eq(q.field("phoneNumber"), args.phone),
      ),
    )
    .first();
}

export async function ensureCustomerProfileFromSources(
  ctx: MutationCtx,
  args: {
    posCustomerId: Id<"posCustomer">;
    storeFrontUserId?: Id<"storeFrontUser">;
    guestId?: Id<"guest">;
    fallbackStoreId: Id<"store">;
  },
) {
  await ensureCustomerProfileFromSourcesWithCtx(ctx, args);
}
