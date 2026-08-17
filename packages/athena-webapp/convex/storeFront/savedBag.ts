import {
  internalMutation,
  internalQuery,
  mutation,
  MutationCtx,
  QueryCtx,
  query,
} from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { deleteSavedBagOperationDefinition } from "../operationAdmission/domains/u6_storefrontCustomer_definitions";
import {
  getAllSavedBagsReadDefinition,
  getSavedBagByIdReadDefinition,
} from "../operationAdmission/domains/u6_storefrontCustomer_readDefinitions";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import {
  assertCustomerOwnsRow,
  assertCustomerOwnsStore,
  assertGuestMergeGranted,
  customerOwnerActorId,
  customerOwnerValidator,
  denyCustomerOwnership,
  guestMergeGrantConsumedPatch,
} from "./customerOwnership";

const entity = "savedBag";
const MAX_SAVED_BAGS = 500;
const MAX_SAVED_BAG_ITEMS = 200;

async function listSavedBagItems(
  ctx: QueryCtx,
  savedBagId: string
) {
  return await ctx.db
    .query("savedBagItem")
    .withIndex("by_savedBagId", (q) => q.eq("savedBagId", savedBagId as any))
    .take(MAX_SAVED_BAG_ITEMS);
}

export const getAll = query({
  args: {},
  handler: admitPublicQuery(getAllSavedBagsReadDefinition, async (ctx) => {
    return await ctx.db.query(entity).take(MAX_SAVED_BAGS);
  }),
});

export const create = internalMutation({
  args: {
    storeId: v.id("store"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, { owner, ...args }) => {
    // A saved bag may only ever be created for the admitted shopper, in the
    // store their claim clamped to.
    assertCustomerOwnsRow(owner, {
      storeFrontUserId: args.storeFrontUserId,
      storeId: args.storeId,
    });

    const id = await ctx.db.insert(entity, {
      ...args,
      updatedAt: Date.now(),
      items: [],
    });

    const bag = await ctx.db.get("savedBag", id);
    return {
      ...bag,
      items: [],
    };
  },
});

async function loadSavedBagById(ctx: QueryCtx, id: Id<"savedBag">) {
  {
    const bag = await ctx.db.get("savedBag", id);
    if (!bag) return null;

    const items = await listSavedBagItems(ctx, bag._id);

    // For each item, retrieve the associated product and its SKUs
    const itemsWithProductDetails = await Promise.all(
      items.map(async (item) => {
        const [sku, product] = await Promise.all([
          ctx.db.get("productSku", item.productSkuId),
          ctx.db.get("product", item.productId),
        ]);

        let colorName;

        if (sku?.color) {
          const color = await ctx.db.get("color", sku.color);
          colorName = color?.name;
        }

        let category: string | undefined;

        if (product) {
          const productCategory = await ctx.db.get("category", product.categoryId);
          category = productCategory?.name;
        }

        return {
          ...item,
          price: sku?.price,
          length: sku?.length,
          colorName,
          productName: product?.name,
          productCategory: category,
          productImage: sku?.images?.[0],
          productSlug: product?.slug,
        };
      })
    );

    // Return the bag with the enriched items
    return {
      ...bag,
      items: itemsWithProductDetails,
    };
  }
}

export const getById = query({
  args: {
    id: v.id(entity),
  },
  handler: admitPublicQuery(
    getSavedBagByIdReadDefinition,
    async (ctx, args: { id: Id<"savedBag"> }) =>
      loadSavedBagById(ctx, args.id),
  ),
});

export const getByIdInternal = internalQuery({
  args: {
    id: v.id(entity),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, args) => {
    const bag = await ctx.db.get("savedBag", args.id);
    assertCustomerOwnsRow(args.owner, bag);
    return await loadSavedBagById(ctx, args.id);
  },
});

export const getByUserId = internalQuery({
  args: {
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, args) => {
    if (
      String(args.storeFrontUserId) !== String(customerOwnerActorId(args.owner))
    ) {
      denyCustomerOwnership();
    }
    const bag = await ctx.db
      .query(entity)
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.storeFrontUserId)
      )
      .first();

    if (!bag) return null;

    const items = await listSavedBagItems(ctx, bag._id);

    // For each item, retrieve the associated product and its SKUs
    const itemsWithProductDetails = await Promise.all(
      items.map(async (item) => {
        const [sku, product] = await Promise.all([
          ctx.db.get("productSku", item.productSkuId),
          ctx.db.get("product", item.productId),
        ]);

        let colorName;

        if (sku?.color) {
          const color = await ctx.db.get("color", sku.color);
          colorName = color?.name;
        }

        let category: string | undefined;

        if (product) {
          const productCategory = await ctx.db.get("category", product.categoryId);
          category = productCategory?.name;
        }

        return {
          ...item,
          price: sku?.price,
          length: sku?.length,
          colorName,
          productName: product?.name,
          productCategory: category,
          productImage: sku?.images?.[0],
          productSlug: product?.slug,
        };
      })
    );

    // Return the bag with the enriched items
    return {
      ...bag,
      items: itemsWithProductDetails,
    };
  },
});

async function deleteSavedBagWithCtx(ctx: MutationCtx, id: Id<"savedBag">) {
  await ctx.db.delete("savedBag", id);

  const items = await ctx.db
    .query("savedBagItem")
    .withIndex("by_savedBagId", (q) => q.eq("savedBagId", id))
    .take(MAX_SAVED_BAG_ITEMS);

  await Promise.all(
    items.map((item) => ctx.db.delete("savedBagItem", item._id)),
  );

  return { message: "Bag and its items deleted" };
}

export const deleteSavedBag = mutation({
  args: {
    id: v.id(entity),
  },
  handler: admitPublicMutation(
    deleteSavedBagOperationDefinition,
    async (ctx, args: { id: Id<"savedBag"> }) =>
      deleteSavedBagWithCtx(ctx, args.id),
  ),
});

export const deleteSavedBagInternal = internalMutation({
  args: {
    id: v.id(entity),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, args) => {
    const bag = await ctx.db.get("savedBag", args.id);
    assertCustomerOwnsRow(args.owner, bag);
    return await deleteSavedBagWithCtx(ctx, args.id);
  },
});

export const updateOwner = internalMutation({
  args: {
    currentOwner: v.id("guest"),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, args) => {
    // Same contract as `bag.updateOwner`, and for the same reason: the
    // destination is the admitted account (never body-supplied) and the source
    // guest session must carry a server-issued merge grant for that account.
    // Nothing the caller presents authorizes this.
    const newOwner = args.owner.storeFrontUserId;
    if (!newOwner) denyCustomerOwnership();

    const guest = await ctx.db.get("guest", args.currentOwner);
    assertGuestMergeGranted(guest, args.owner, "savedBag");
    assertCustomerOwnsStore(args.owner, guest?.storeId);

    if (String(customerOwnerActorId(args.owner)) !== String(newOwner)) {
      denyCustomerOwnership();
    }

    // Single-use; see `bag.updateOwner` for why it is consumed up front.
    await ctx.db.patch(
      "guest",
      args.currentOwner,
      guestMergeGrantConsumedPatch(guest!, "savedBag"),
    );

    const savedBag = await ctx.db
      .query(entity)
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.currentOwner)
      )
      .first();

    const newOwnerBag = await ctx.db
      .query(entity)
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", newOwner)
      )
      .first();

    // Neither saved bag may cross tenants.
    if (savedBag) assertCustomerOwnsStore(args.owner, savedBag.storeId);
    if (newOwnerBag) assertCustomerOwnsStore(args.owner, newOwnerBag.storeId);

    if (!savedBag) {
      return null; // No guest bag exists
    }

    if (newOwnerBag) {
      // Get items from current bag
      const currentItems = await ctx.db
        .query("savedBagItem")
        .withIndex("by_savedBagId", (q) => q.eq("savedBagId", savedBag._id))
        .take(MAX_SAVED_BAG_ITEMS);

      // Get items from new owner's bag
      const newOwnerItems = await ctx.db
        .query("savedBagItem")
        .withIndex("by_savedBagId", (q) => q.eq("savedBagId", newOwnerBag._id))
        .take(MAX_SAVED_BAG_ITEMS);

      // Process each item from current bag
      await Promise.all(
        currentItems.map(async (item) => {
          // Check if item already exists in new owner's bag
          const existingItem = newOwnerItems.find(
            (newItem) =>
              newItem.productId === item.productId &&
              newItem.productSkuId === item.productSkuId
          );

          if (existingItem) {
            // Update quantity of existing item
            await ctx.db.patch("savedBagItem", existingItem._id, {
              quantity: existingItem.quantity + item.quantity,
              savedBagId: newOwnerBag._id,
              storeFrontUserId: newOwner,
            });
            // Delete the duplicate item
            await ctx.db.delete("savedBagItem", item._id);
          } else {
            // Move item to new owner's bag
            await ctx.db.patch("savedBagItem", item._id, {
              savedBagId: newOwnerBag._id,
              storeFrontUserId: newOwner,
            });
          }
        })
      );

      await ctx.db.delete("savedBag", savedBag._id);
      return await ctx.db.get("savedBag", newOwnerBag._id);
    } else {
      // If new owner doesn't have a bag, update the ownership of existing bag
      await ctx.db.patch("savedBag", savedBag._id, {
        storeFrontUserId: newOwner,
        updatedAt: Date.now(),
      });
      return await ctx.db.get("savedBag", savedBag._id);
    }
  },
});
