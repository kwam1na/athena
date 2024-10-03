import { db, toSlug, type CategoryRequest } from "../../index";
import { and, eq } from "drizzle-orm";
import { categories } from "../../models/schema";

export const categoriesRepository = {
  getAll: async (storeId: number, organizationId: number) =>
    await db
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.storeId, storeId),
          eq(categories.organizationId, organizationId)
        )
      ),

  getById: async (id: number) => {
    const res = await db.select().from(categories).where(eq(categories.id, id));

    return res[0];
  },

  create: async (data: CategoryRequest) => {
    const params = { ...data, slug: toSlug(data.name) };

    const res = await db.insert(categories).values(params).returning();

    return res[0];
  },

  update: async (id: number, data: Partial<CategoryRequest>) => {
    const params = {
      ...data,
      ...(data.name && { slug: toSlug(data.name) }),
      updatedAt: new Date(),
    };

    const res = await db
      .update(categories)
      .set(params)
      .where(eq(categories.id, id))
      .returning();

    return res[0];
  },

  delete: async (id: number) => {
    const res = await db
      .delete(categories)
      .where(eq(categories.id, id))
      .returning();

    return res[0];
  },
};
