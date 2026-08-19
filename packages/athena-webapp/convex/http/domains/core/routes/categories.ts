import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { listCategoriesRouteReadDefinition } from "../../../../operationAdmission/domains/httpCore_readDefinitions";
import { admitHttpRead } from "../../../../platform/operationAdmission";
import { getStoreDataFromRequest } from "../../../utils";

const categoryRoutes: HonoWithConvex<ActionCtx> = new Hono();
const STOREFRONT_HIDDEN_CATEGORY_SLUGS = new Set(["pos-quick-add"]);
const STOREFRONT_HIDDEN_SUBCATEGORY_SLUGS = new Set(["uncategorized"]);

export function shouldShowCategoryOnStorefront(category: {
  showOnStorefront?: boolean;
  slug?: string;
}) {
  if (category.showOnStorefront === false) {
    return false;
  }

  return !category.slug || !STOREFRONT_HIDDEN_CATEGORY_SLUGS.has(category.slug);
}

export function removeStorefrontHiddenCategories<
  T extends { showOnStorefront?: boolean; slug?: string },
>(categories: T[]) {
  return categories.filter(
    (category) => shouldShowCategoryOnStorefront(category),
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

categoryRoutes.get(
  "/",
  admitHttpRead(listCategoriesRouteReadDefinition, async (c) => {
    const { storeId } = getStoreDataFromRequest(c);

    const queryParams = c.req.queries();

    if (!storeId)
      return c.json({ error: "Missing data to retrieve categories" }, 400);

    if (queryParams.withSubcategories) {
      const categories: Array<{
        showOnStorefront?: boolean;
        slug?: string;
        subcategories?: Array<{ slug?: string }>;
      }> = await c.env.runQuery(
        internal.inventory.categories.getCategoriesWithSubcategoriesInternal,
        {
          storeId: storeId as Id<"store">,
        },
      );

      return c.json({
        categories: removeStorefrontHiddenSubcategories(
          removeStorefrontHiddenCategories(categories),
        ),
      });
    }

    const categories = await c.env.runQuery(
      internal.inventory.categories.getAllInternal,
      {
        storeId: storeId as Id<"store">,
      },
    );

    return c.json({ categories: removeStorefrontHiddenCategories(categories) });
  }),
);

export { categoryRoutes };
