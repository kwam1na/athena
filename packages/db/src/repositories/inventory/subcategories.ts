import { db, toSlug, type SubcategoryRequest } from "../../index";
import { and, eq } from "drizzle-orm";
import { subcategories } from "../../models/schema";

export const subcategoriesRepository = {
  getAll: async (storeId: number, organizationId: number) =>
    await db
      .select()
      .from(subcategories)
      .where(
        and(
          eq(subcategories.storeId, storeId),
          eq(subcategories.organizationId, organizationId)
        )
      ),

  getById: async (id: number) => {
    const res = await db
      .select()
      .from(subcategories)
      .where(eq(subcategories.id, id));

    return res[0];
  },

  create: async (data: SubcategoryRequest) => {
    const params = { ...data, slug: toSlug(data.name) };

    const res = await db.insert(subcategories).values(params).returning();

    return res[0];
  },

  update: async (id: number, data: Partial<SubcategoryRequest>) => {
    const params = {
      ...data,
      ...(data.name && { slug: toSlug(data.name) }),
      updatedAt: new Date(),
    };

    const res = await db
      .update(subcategories)
      .set(params)
      .where(eq(subcategories.id, id))
      .returning();

    return res[0];
  },

  delete: async (id: number) => {
    const res = await db
      .delete(subcategories)
      .where(eq(subcategories.id, id))
      .returning();

    return res[0];
  },
};
