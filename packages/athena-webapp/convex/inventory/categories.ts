import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { categorySchema } from "../schemas/inventory";
import { Id } from "../_generated/dataModel";

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
    const categories = await ctx.db
      .query(entity)
      .filter((q) =>
        q.and(
          q.eq(q.field("_id"), args.id),
          q.eq(q.field("storeId"), args.storeId)
        )
      )
      .collect();

    return categories;
  },
});

export const create = mutation({
  args: categorySchema,
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, args);

    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    name: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { name: args.name, slug: args.slug });

    return await ctx.db.get(args.id);
  },
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);

    return { message: "OK" };
  },
});
