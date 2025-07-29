import { api } from "../_generated/api";
import { Doc } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { getProductName } from "../utils";

const entity = "bag";

export const getAll = query({
  handler: async (ctx) => {
    return await ctx.db.query(entity).collect();
  },
});

export const create = mutation({
  args: {
    storeId: v.id("store"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, {
      ...args,
      updatedAt: Date.now(),
      items: [],
    });

    const bag = await ctx.db.get(id);
    return {
      ...bag,
      items: [],
    };
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    const bag = await ctx.db.get(args.id);

    if (!bag) return null;

    const items = await ctx.db
      .query("bagItem")
      .withIndex("by_bagId", (q) => q.eq("bagId", bag._id))
      .collect();

    // For each item, retrieve the associated product and its SKUs
    const itemsWithProductDetails = await Promise.all(
      items.map(async (item) => {
        const [sku, product] = await Promise.all([
          ctx.db.get(item.productSkuId),
          ctx.db.get(item.productId),
        ]);

        let colorName;

        if (sku?.color) {
          const color = await ctx.db.get(sku.color);
          colorName = color?.name;
        }

        let category: string | undefined;

        if (product) {
          const productCategory = await ctx.db.get(product.categoryId);
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
        } as Doc<"bagItem">;
      })
    );

    // Return the bag with the enriched items
    return {
      ...bag,
      items: itemsWithProductDetails,
    } as Doc<"bag">;
  },
});

export const getByUserId = query({
  args: {
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  },
  handler: async (ctx, args) => {
    const bag = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeFrontUserId"), args.storeFrontUserId))
      .first();

    if (!bag) return null;

    const items = await ctx.db
      .query("bagItem")
      .withIndex("by_bagId", (q) => q.eq("bagId", bag._id))
      .collect();

    // For each item, retrieve the associated product and its SKUs
    const itemsWithProductDetails = await Promise.all(
      items.map(async (item) => {
        const [sku, product] = await Promise.all([
          ctx.db.get(item.productSkuId),
          ctx.db.get(item.productId),
        ]);

        let colorName;

        if (sku?.color) {
          const color = await ctx.db.get(sku.color);
          colorName = color?.name;
        }

        let category: string | undefined;

        if (product) {
          const productCategory = await ctx.db.get(product.categoryId);
          category = productCategory?.name;
        }

        // Count how many other bags have this same product SKU
        const otherBagItemsWithSameSku = await ctx.db
          .query("bagItem")
          .withIndex("by_productSkuId", (q) =>
            q.eq("productSkuId", item.productSkuId)
          )
          .collect();

        // Filter out items from the current user's bag and count unique bags
        const uniqueOtherBagIds = new Set(
          otherBagItemsWithSameSku
            .filter((bagItem) => bagItem.bagId !== bag._id)
            .map((bagItem) => bagItem.bagId)
        );

        const otherBagsWithSku = uniqueOtherBagIds.size;

        return {
          ...item,
          price: sku?.price,
          length: sku?.length,
          colorName,
          productName: product?.name,
          productCategory: category,
          productImage: sku?.images?.[0],
          productSlug: product?.slug,
          otherBagsWithSku,
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

export const deleteBag = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);

    const items = await ctx.db
      .query("bagItem")
      .filter((q) => q.eq(q.field("bagId"), args.id))
      .collect();

    await Promise.all(items.map((item) => ctx.db.delete(item._id)));

    return { message: "Bag and its items deleted" };
  },
});

export const clearBag = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("bagItem")
      .filter((q) => q.eq(q.field("bagId"), args.id))
      .collect();

    await Promise.all(items.map((item) => ctx.db.delete(item._id)));

    return { message: "Items in bag cleared" };
  },
});

export const updateOwner = mutation({
  args: {
    currentOwner: v.id("guest"),
    newOwner: v.id("storeFrontUser"),
  },
  handler: async (ctx, args) => {
    const bag = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeFrontUserId"), args.currentOwner))
      .first();

    const newOwnerBag = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeFrontUserId"), args.newOwner))
      .first();

    console.log("updating bag owner.", args.currentOwner, args.newOwner);

    if (!bag) {
      console.log("bag not found.");
      return null; // No guest bag exists
    }

    if (newOwnerBag) {
      // Get items from current bag
      const currentItems = await ctx.db
        .query("bagItem")
        .filter((q) => q.eq(q.field("bagId"), bag._id))
        .collect();

      // Get items from new owner's bag
      const newOwnerItems = await ctx.db
        .query("bagItem")
        .filter((q) => q.eq(q.field("bagId"), newOwnerBag._id))
        .collect();

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
            await ctx.db.patch(existingItem._id, {
              quantity: existingItem.quantity + item.quantity,
              bagId: newOwnerBag._id,
              storeFrontUserId: args.newOwner,
            });
            // Delete the duplicate item
            await ctx.db.delete(item._id);
          } else {
            // Move item to new owner's bag
            await ctx.db.patch(item._id, {
              bagId: newOwnerBag._id,
              storeFrontUserId: args.newOwner,
            });
          }
        })
      );

      console.log(
        `successfully updated bag owner from ${args.currentOwner} to ${args.newOwner}.`
      );

      await ctx.db.delete(bag._id);
      return await ctx.db.get(newOwnerBag._id);
    } else {
      // If new owner doesn't have a bag, update the ownership of existing bag
      await ctx.db.patch(bag._id, {
        storeFrontUserId: args.newOwner,
        updatedAt: Date.now(),
      });

      console.log(
        `successfully updated bag owner from ${args.currentOwner} to ${args.newOwner}.`
      );
      return await ctx.db.get(bag._id);
    }
  },
});

export const getPaginatedBags = query({
  args: {
    storeId: v.id("store"),
    pagination: v.object({
      pageIndex: v.number(),
      pageSize: v.number(),
    }),
    sorting: v.optional(
      v.array(
        v.object({
          id: v.string(),
          desc: v.boolean(),
        })
      )
    ),
    filters: v.optional(
      v.array(
        v.object({
          id: v.string(),
          value: v.any(),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeId"), args.storeId));

    // Get all bags first
    let bags = await query.collect();

    // Apply sorting if provided
    if (args.sorting && args.sorting.length > 0) {
      const sort = args.sorting[0]; // For now, we'll only handle single column sorting
      if (sort.id === "updatedAt") {
        bags.sort((a, b) => {
          const aTime = a.updatedAt;
          const bTime = b.updatedAt;
          return sort.desc ? bTime - aTime : aTime - bTime;
        });
      }
    }

    // Apply filters if provided
    if (args.filters) {
      for (const filter of args.filters) {
        if (filter.value) {
          if (filter.id === "storeFrontUserId") {
            bags = bags.filter((bag) => bag.storeFrontUserId === filter.value);
          }
        }
      }
    }

    // Enrich bags with their items
    const enrichedBags = await Promise.all(
      bags.map(async (bag: Doc<"bag">) => {
        const items = await ctx.db
          .query("bagItem")
          .withIndex("by_bagId", (q) => q.eq("bagId", bag._id))
          .collect();

        // For each item, retrieve the associated product and its SKUs
        const itemsWithProductDetails = await Promise.all(
          items.map(async (item) => {
            const [sku, product] = await Promise.all([
              ctx.db.get(item.productSkuId),
              ctx.db.get(item.productId),
            ]);

            let colorName;
            if (sku?.color) {
              const color = await ctx.db.get(sku.color);
              colorName = color?.name;
            }

            let category: string | undefined;
            if (product) {
              const productCategory = await ctx.db.get(product.categoryId);
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

        // Calculate total for the bag
        const total = itemsWithProductDetails.reduce(
          (sum, item) => sum + (item.price || 0) * item.quantity,
          0
        );

        return {
          ...bag,
          items: itemsWithProductDetails,
          total,
        };
      })
    );

    // Filter out bags with total <= 0
    let filteredBags = enrichedBags.filter((bag) => bag.total > 0);

    // Apply sorting after enrichment
    if (args.sorting && args.sorting.length > 0) {
      const sort = args.sorting[0];
      filteredBags = filteredBags.sort((a, b) => {
        const aValue = (a as any)[sort.id];
        const bValue = (b as any)[sort.id];
        if (aValue === undefined || bValue === undefined) return 0;
        if (typeof aValue === "number" && typeof bValue === "number") {
          return sort.desc ? bValue - aValue : aValue - bValue;
        }
        if (typeof aValue === "string" && typeof bValue === "string") {
          return sort.desc
            ? bValue.localeCompare(aValue)
            : aValue.localeCompare(bValue);
        }
        return 0;
      });
    } else {
      // Default: sort by updatedAt descending
      filteredBags = filteredBags.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    // Apply pagination
    const totalCount = filteredBags.length;
    const skip = args.pagination.pageIndex * args.pagination.pageSize;
    const paginatedFilteredBags = filteredBags.slice(
      skip,
      skip + args.pagination.pageSize
    );

    return {
      items: paginatedFilteredBags,
      totalCount,
      pageCount: Math.ceil(totalCount / args.pagination.pageSize),
    };
  },
});
