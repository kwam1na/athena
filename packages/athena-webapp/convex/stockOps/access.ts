import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type StockOpsAccessCtx = QueryCtx | MutationCtx;

export async function requireStoreFullAdminAccess(
  ctx: StockOpsAccessCtx,
  storeId: Id<"store">
) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity?.email) {
    throw new Error("Authentication required.");
  }

  const identityEmail = identity.email;

  const store = await ctx.db.get("store", storeId);

  if (!store) {
    throw new Error("Store not found.");
  }

  const athenaUser =
    (await ctx.db
      .query("athenaUser")
      .filter((q) => q.eq(q.field("email"), identityEmail))
      .first()) ??
    (identityEmail.toLowerCase() === identityEmail
      ? null
      : await ctx.db
          .query("athenaUser")
          .filter((q) => q.eq(q.field("email"), identityEmail.toLowerCase()))
          .first());

  if (!athenaUser) {
    throw new Error("Athena user not found.");
  }

  const membership = await ctx.db
    .query("organizationMember")
    .filter((q) =>
      q.and(
        q.eq(q.field("userId"), athenaUser._id),
        q.eq(q.field("organizationId"), store.organizationId)
      )
    )
    .first();

  if (membership?.role !== "full_admin") {
    throw new Error("Only full admins can access stock operations.");
  }

  return {
    athenaUser,
    store,
  };
}
