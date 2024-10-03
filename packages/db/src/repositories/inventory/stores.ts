import { db, productsRepository, toSlug, type StoreRequest } from "../../index";
import { eq } from "drizzle-orm";
import { categories, stores, subcategories } from "../../models/schema";

export const storeRepository = {
  getAll: async (organizationId: number) =>
    await db
      .select()
      .from(stores)
      .where(eq(stores.organizationId, organizationId)),

  getById: async (id: number) => {
    // Fetch the store and join the related categories and subcategories
    const storeData = await db
      .select({
        store: stores,
        categories: categories,
        subcategories: subcategories,
      })
      .from(stores)
      .leftJoin(categories, eq(categories.storeId, stores.id)) // Join categories by storeId
      .leftJoin(subcategories, eq(subcategories.categoryId, categories.id)) // Join subcategories by categoryId
      .where(eq(stores.id, id));

    // Process the data in one pass, avoiding redundant loops
    const categoriesMap = new Map<
      number,
      { id: number; name: string; slug: string; subcategories: any[] }
    >();
    const subcategoriesSet = new Set<{
      id: number;
      name: string;
      slug: string;
    }>();

    storeData.forEach((row) => {
      // Map categories
      if (row.categories?.id) {
        if (!categoriesMap.has(row.categories.id)) {
          categoriesMap.set(row.categories.id, {
            id: row.categories.id,
            name: row.categories.name,
            slug: row.categories.slug,
            subcategories: [],
          });
        }
      }

      // Map subcategories under the appropriate category
      if (
        row.subcategories?.id &&
        row.categories?.id &&
        categoriesMap.has(row.categories?.id)
      ) {
        categoriesMap.get(row.categories?.id)?.subcategories.push({
          id: row.subcategories.id,
          name: row.subcategories.name,
          slug: row.subcategories.slug,
        });

        // Also add to flat subcategories set
        subcategoriesSet.add({
          id: row.subcategories.id,
          name: row.subcategories.name,
          slug: row.subcategories.slug,
        });
      }
    });

    // Convert Map and Set to arrays
    const result = {
      ...storeData[0].store,
      categories: Array.from(categoriesMap.values()),
      subcategories: Array.from(subcategoriesSet),
    };

    return result;
  },

  getBySlug: async (slug: string) => {
    const storeData = await db
      .select({
        store: stores,
        categories: categories,
        subcategories: subcategories,
      })
      .from(stores)
      .leftJoin(categories, eq(categories.storeId, stores.id)) // Join categories by storeId
      .leftJoin(subcategories, eq(subcategories.categoryId, categories.id)) // Join subcategories by categoryId
      .where(eq(stores.slug, slug));

    // Process the data in one pass, avoiding redundant loops
    const categoriesMap = new Map<
      number,
      { id: number; name: string; slug: string; subcategories: any[] }
    >();
    const subcategoriesSet = new Set<{
      id: number;
      name: string;
      slug: string;
    }>();

    storeData.forEach((row) => {
      // Map categories
      if (row.categories?.id) {
        if (!categoriesMap.has(row.categories.id)) {
          categoriesMap.set(row.categories.id, {
            id: row.categories.id,
            name: row.categories.name,
            slug: row.categories.slug,
            subcategories: [],
          });
        }
      }

      // Map subcategories under the appropriate category
      if (
        row.subcategories?.id &&
        row.categories?.id &&
        categoriesMap.has(row.categories?.id)
      ) {
        categoriesMap.get(row.categories?.id)?.subcategories.push({
          id: row.subcategories.id,
          name: row.subcategories.name,
          slug: row.subcategories.slug,
        });

        // Also add to flat subcategories set
        subcategoriesSet.add({
          id: row.subcategories.id,
          name: row.subcategories.name,
          slug: row.subcategories.slug,
        });
      }
    });

    // Convert Map and Set to arrays
    const result = {
      ...storeData[0].store,
      categories: Array.from(categoriesMap.values()),
      subcategories: Array.from(subcategoriesSet),
    };

    return result;
  },

  create: async (data: StoreRequest) => {
    const params = { ...data, slug: toSlug(data.name) };

    const res = await db.insert(stores).values(params).returning();

    return res[0];
  },

  update: async (id: number, data: Partial<StoreRequest>) => {
    const params = {
      ...data,
      ...(data.name && { slug: toSlug(data.name) }),
      updatedAt: new Date(),
    };

    const res = await db
      .update(stores)
      .set(params)
      .where(eq(stores.id, id))
      .returning();

    return res[0];
  },

  delete: async (id: number) => {
    const res = await db.delete(stores).where(eq(stores.id, id)).returning();
    return res[0];
  },

  deleteAllProducts: async (id: number) => {
    return await productsRepository.deleteAllByStoreId(id);
  },
};
