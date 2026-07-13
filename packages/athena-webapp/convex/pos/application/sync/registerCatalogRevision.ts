import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";

type RegisterCatalogRevisionReadCtx = Pick<QueryCtx, "db">;

async function readRegisterCatalogRevisionRow(
  ctx: RegisterCatalogRevisionReadCtx,
  storeId: Id<"store">,
) {
  return ctx.db
    .query("posRegisterCatalogRevision")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();
}

export async function readRegisterCatalogRevision(
  ctx: RegisterCatalogRevisionReadCtx,
  storeId: Id<"store">,
) {
  const current = await readRegisterCatalogRevisionRow(ctx, storeId);
  return current?.revision ?? 0;
}

export async function advanceRegisterCatalogRevision(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    didChange: boolean;
  },
) {
  const current = await readRegisterCatalogRevisionRow(ctx, args.storeId);
  if (!args.didChange) return current?.revision ?? 0;

  const revision = (current?.revision ?? 0) + 1;
  const value = {
    revision,
    updatedAt: Date.now(),
  };

  if (current) {
    await ctx.db.patch("posRegisterCatalogRevision", current._id, value);
  } else {
    await ctx.db.insert("posRegisterCatalogRevision", {
      storeId: args.storeId,
      ...value,
    });
  }

  return revision;
}
