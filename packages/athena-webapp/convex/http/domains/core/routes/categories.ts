import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getStoreDataFromRequest } from "../../../utils";

const categoryRoutes: HonoWithConvex<ActionCtx> = new Hono();
const STOREFRONT_HIDDEN_CATEGORY_SLUGS = new Set(["pos-quick-add"]);
const STOREFRONT_HIDDEN_SUBCATEGORY_SLUGS = new Set(["uncategorized"]);

export function removeStorefrontHiddenCategories<T extends { slug?: string }>(
  categories: T[],
) {
  return categories.filter(
    (category) =>
      !category.slug || !STOREFRONT_HIDDEN_CATEGORY_SLUGS.has(category.slug),
  );
}

export function removeStorefrontHiddenSubcategories<
  T extends { subcategories?: Array<{ slug?: string }> },
>(categories: T[]) {
  return categories.map((category) => ({
    ...category,
    subcategories: category.subcategories?.filter(
      (subcategory) =>
        !subcategory.slug ||
        !STOREFRONT_HIDDEN_SUBCATEGORY_SLUGS.has(subcategory.slug),
    ),
  }));
}

categoryRoutes.get("/", async (c) => {
  const { storeId } = getStoreDataFromRequest(c);

  const queryParams = c.req.queries();

  if (!storeId)
    return c.json({ error: "Missing data to retrieve categories" }, 400);

  if (queryParams.withSubcategories) {
    const categories = await c.env.runQuery(
      api.inventory.categories.getCategoriesWithSubcategories,
      {
        storeId: storeId as Id<"store">,
      }
    );

    return c.json({
      categories: removeStorefrontHiddenSubcategories(
        removeStorefrontHiddenCategories(categories),
      ),
    });
  }

  const categories = await c.env.runQuery(api.inventory.categories.getAll, {
    storeId: storeId as Id<"store">,
  });

  return c.json({ categories: removeStorefrontHiddenCategories(categories) });
});

export { categoryRoutes };
