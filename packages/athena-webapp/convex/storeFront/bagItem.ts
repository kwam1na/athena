import { internalMutation, query } from "../_generated/server";
import { v } from "convex/values";
import { loadBagWithItems } from "./helpers/bag";
import { getBagItemsForStoreReadDefinition } from "../operationAdmission/domains/storefrontCustomer_readDefinitions";
import { admitPublicQuery } from "../platform/operationAdmission";
import {
  assertCustomerOwnsRow,
  customerOwnerValidator,
  type CustomerOwner,
} from "./customerOwnership";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const entity = "bagItem";
const MAX_BAGS_FOR_STORE = 500;

/**
 * The three mutations below are the ownership gaps the plan names explicitly:
 * `addItemToBag` patched and inserted into ANY `bagId`, and
 * `updateItemInBag` / `deleteItemFromBag` acted on a bare `itemId`. A storefront
 * shopper reaches all three through `POST|PUT|DELETE /bags/:bagId/items`, whose
 * only identity is a bearer cookie, so a valid id for customer A could reach
 * customer B's rows.
 *
 * The fix is the `owner` parameter: the admitted `storefront_customer` actor is
 * propagated from the route and every caller-supplied id is resolved to its row
 * and checked against it. `owner` is required — every caller of these three is
 * a storefront route with an admitted claim, so there is no shape of this call
 * that legitimately skips the assertion.
 */

/** Resolve the bag an item belongs to so the item inherits its parent's owner. */
async function requireOwnedBagItem(
  ctx: MutationCtx,
  itemId: Id<"bagItem">,
  owner: CustomerOwner,
) {
  const item = await ctx.db.get(entity, itemId);
  // The join row carries the shopper id; the store comes from the parent bag,
  // so both halves of the claim are checked rather than just one.
  assertCustomerOwnsRow(owner, item);
  const bag = item ? await ctx.db.get("bag", item.bagId) : null;
  assertCustomerOwnsRow(owner, bag);
  return item;
}

export const addItemToBag = internalMutation({
  args: {
    bagId: v.id("bag"),
    productId: v.id("product"),
    productSkuId: v.id("productSku"),
    productSku: v.string(),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    quantity: v.number(),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, { owner, ...args }) => {
    // The bag must belong to the admitted shopper AND the identity written
    // onto the new item must be the admitted shopper, not the request body's.
    const bag = await ctx.db.get("bag", args.bagId);
    assertCustomerOwnsRow(owner, bag);
    assertCustomerOwnsRow(owner, {
      storeFrontUserId: args.storeFrontUserId,
    });

    const newItem = { ...args, updatedAt: Date.now() };

    const existing = await ctx.db
      .query(entity)
      .withIndex("by_bagId_storeFrontUserId_productSkuId", (q) =>
        q
          .eq("bagId", args.bagId)
          .eq("storeFrontUserId", args.storeFrontUserId)
          .eq("productSkuId", args.productSkuId),
      )
      .first();

    // update the bag's updatedAt field
    await ctx.db.patch("bag", args.bagId, { updatedAt: Date.now() });

    if (existing) {
      return await ctx.db.patch("bagItem", existing._id, {
        quantity: existing.quantity + args.quantity,
        updatedAt: Date.now(),
      });
    }

    return await ctx.db.insert(entity, newItem);
  },
});

export const updateItemInBag = internalMutation({
  args: {
    itemId: v.id(entity),
    quantity: v.number(),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, args) => {
    await requireOwnedBagItem(ctx, args.itemId, args.owner);
    return await ctx.db.patch("bagItem", args.itemId, {
      quantity: args.quantity,
    });
  },
});

export const deleteItemFromBag = internalMutation({
  args: {
    itemId: v.id(entity),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, args) => {
    await requireOwnedBagItem(ctx, args.itemId, args.owner);
    await ctx.db.delete("bagItem", args.itemId);
    return { message: "Item deleted from bag" };
  },
});

export const getBagItemsForStore = query({
  args: {
    storeId: v.id("store"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: admitPublicQuery(
    getBagItemsForStoreReadDefinition,
    async (ctx, args: { storeId: Id<"store">; cursor: string | null }) => {
      // Get all the bags for the store
      const bags = await ctx.db
        .query("bag")
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .order("desc")
        .take(MAX_BAGS_FOR_STORE);

      // Get all the items for the bags
      const items: any[] = await Promise.all(
        bags.map(async (bag) => await loadBagWithItems(ctx, bag)),
      );

      return items.filter((item) => item.items.length > 0);
    },
  ),
});
