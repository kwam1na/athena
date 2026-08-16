import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import {
  assertCustomerOwnsRowIfPropagated,
  customerOwnerValidator,
  type CustomerOwner,
} from "./customerOwnership";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const entity = "savedBagItem";

/**
 * The same ownership gap `bagItem.ts` closed, on the saved-bag twin.
 *
 * `addItemToBag` inserted into ANY `savedBagId`, and `updateItemInBag` /
 * `deleteItemFromSavedBag` acted on a bare `itemId`. A storefront shopper
 * reaches all three through `POST|PUT|DELETE /savedBags/:bagId/items`, whose
 * only identity is a bearer cookie, so a valid id for customer A could reach
 * customer B's rows.
 *
 * The fix is the `owner` parameter: the admitted `storefront_customer` actor
 * travels from the route and every caller-supplied id is resolved to its row and
 * checked against it. It matches `bagItem.ts` exactly, including `owner` being
 * optional so the assertion is live precisely when a caller propagates it.
 */

/** Resolve the saved bag an item belongs to so it inherits its parent's owner. */
async function requireOwnedSavedBagItem(
  ctx: MutationCtx,
  itemId: Id<"savedBagItem">,
  owner: CustomerOwner | undefined,
) {
  const item = await ctx.db.get(entity, itemId);
  if (!owner) return item;
  // The join row carries the shopper id; the store comes from the parent saved
  // bag, so both halves of the claim are checked rather than just one.
  assertCustomerOwnsRowIfPropagated(owner, item);
  const savedBag = item ? await ctx.db.get("savedBag", item.savedBagId) : null;
  assertCustomerOwnsRowIfPropagated(owner, savedBag);
  return item;
}

export const addItemToBag = internalMutation({
  args: {
    savedBagId: v.id("savedBag"),
    productId: v.id("product"),
    productSkuId: v.id("productSku"),
    productSku: v.string(),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    quantity: v.number(),
    owner: v.optional(customerOwnerValidator),
  },
  handler: async (ctx, { owner, ...args }) => {
    if (owner) {
      // The saved bag must belong to the admitted shopper AND the identity
      // written onto the new item must be the admitted shopper, not the body's.
      const savedBag = await ctx.db.get("savedBag", args.savedBagId);
      assertCustomerOwnsRowIfPropagated(owner, savedBag);
      assertCustomerOwnsRowIfPropagated(owner, {
        storeFrontUserId: args.storeFrontUserId,
      });
    }

    const newItem = { ...args, updatedAt: Date.now() };

    const existing = await ctx.db
      .query(entity)
      .withIndex("by_savedBagId_storeFrontUserId_productSkuId", (q) =>
        q
          .eq("savedBagId", args.savedBagId)
          .eq("storeFrontUserId", args.storeFrontUserId)
          .eq("productSkuId", args.productSkuId),
      )
      .first();

    if (existing) {
      return await ctx.db.patch("savedBagItem", existing._id, {
        quantity: existing.quantity + args.quantity,
      });
    }

    return await ctx.db.insert(entity, newItem);
  },
});

export const updateItemInBag = internalMutation({
  args: {
    itemId: v.id(entity),
    quantity: v.number(),
    owner: v.optional(customerOwnerValidator),
  },
  handler: async (ctx, args) => {
    await requireOwnedSavedBagItem(ctx, args.itemId, args.owner);
    return await ctx.db.patch("savedBagItem", args.itemId, {
      quantity: args.quantity,
    });
  },
});

export const deleteItemFromSavedBag = internalMutation({
  args: {
    itemId: v.id(entity),
    owner: v.optional(customerOwnerValidator),
  },
  handler: async (ctx, args) => {
    await requireOwnedSavedBagItem(ctx, args.itemId, args.owner);
    await ctx.db.delete("savedBagItem", args.itemId);
    return { message: "Item deleted from saved bag" };
  },
});
