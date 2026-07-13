/* eslint-disable @convex-dev/no-collect-in-query -- Admin category selectors and storefront navigation need full store-scoped category lists; category counts are bounded operational taxonomy. */
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { categorySchema } from "../schemas/inventory";
import { Id } from "../_generated/dataModel";
import { refreshProductSkuSearchForCategory } from "./skuSearch";
import { markCatalogSummaryNeedsRefresh } from "./catalogSummary";
import { requireNonDemoFoundationMutation } from "../sharedDemo/foundation";
import { requireAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";

const entity = "category";

export const getAll = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const categories = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .collect();

    return categories;
  },
});

export const getCategoriesWithSubcategories = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    // Fetch all categories for the given storeId
    const categories = await ctx.db
      .query("category")
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .collect();

    // Fetch all subcategories for the storeId in a single query
    const subcategories = await ctx.db
      .query("subcategory")
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .collect();

    // Group subcategories by their categoryId
    const subcategoriesByCategoryId: Record<
      Id<"category">,
      (typeof subcategories)[0][]
    > = subcategories.reduce(
      (map, subcategory) => {
        if (!map[subcategory.categoryId]) {
          map[subcategory.categoryId] = [];
        }
        map[subcategory.categoryId].push(subcategory);
        return map;
      },
      {} as Record<Id<"category">, (typeof subcategories)[0][]>
    );

    // Map categories to include their subcategories
    const categoriesWithSubcategories = categories.map((category) => ({
      ...category,
      subcategories: subcategoriesByCategoryId[category._id] || [],
    }));

    return categoriesWithSubcategories;
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
    storeId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get("category", args.id);
  },
});

export const create = mutation({
  args: categorySchema,
  handler: async (ctx, args) => {
    await requireAuthenticatedAthenaUserWithCtx(ctx);
    requireNonDemoFoundationMutation({ storeId: args.storeId });
    const id = await ctx.db.insert(entity, args);
    await markCatalogSummaryNeedsRefresh(ctx, args.storeId);

    return await ctx.db.get("category", id);
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    name: v.optional(v.string()),
    showOnStorefront: v.optional(v.boolean()),
    slug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAuthenticatedAthenaUserWithCtx(ctx);
    const category = await ctx.db.get("category", args.id);
    if (category) requireNonDemoFoundationMutation({ storeId: category.storeId });
    const patch: Partial<{
      name: string;
      showOnStorefront: boolean;
      slug: string;
    }> = {};

    if (args.name !== undefined) {
      patch.name = args.name;
    }

    if (args.slug !== undefined) {
      patch.slug = args.slug;
    }

    if (args.showOnStorefront !== undefined) {
      patch.showOnStorefront = args.showOnStorefront;
    }

    await ctx.db.patch("category", args.id, patch);
    await refreshProductSkuSearchForCategory(ctx, args.id);
    if (category) {
      await markCatalogSummaryNeedsRefresh(ctx, category.storeId);
    }

    return await ctx.db.get("category", args.id);
  },
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    await requireAuthenticatedAthenaUserWithCtx(ctx);
    const category = await ctx.db.get("category", args.id);
    if (category) requireNonDemoFoundationMutation({ storeId: category.storeId });
    await ctx.db.delete("category", args.id);
    await refreshProductSkuSearchForCategory(ctx, args.id);
    if (category) {
      await markCatalogSummaryNeedsRefresh(ctx, category.storeId);
    }

    return { message: "OK" };
  },
});
