import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import {
  createSubcategoryRouteOperationDefinition,
  deleteSubcategoryRouteOperationDefinition,
  updateSubcategoryRouteOperationDefinition,
} from "../../../../operationAdmission/domains/httpCore_definitions";
import {
  getSubcategoryRouteReadDefinition,
  listSubcategoriesRouteReadDefinition,
} from "../../../../operationAdmission/domains/httpCore_readDefinitions";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";

const subcategoryRoutes: HonoWithConvex<ActionCtx> = new Hono();
const STOREFRONT_HIDDEN_SUBCATEGORY_SLUGS = new Set(["uncategorized"]);

export function removeStorefrontHiddenSubcategoryList<
  T extends { slug?: string },
>(subcategories: T[]) {
  return subcategories.filter(
    (subcategory) =>
      !subcategory.slug ||
      !STOREFRONT_HIDDEN_SUBCATEGORY_SLUGS.has(subcategory.slug),
  );
}

// The four management stubs below have never done anything: they parse their
// input and return an empty object. They stay registered (removing a route is
// not this unit's call) but they are now operator ingress rather than
// anonymous ingress, so an unauthenticated caller no longer gets a 200 from a
// catalog-management path.
subcategoryRoutes.post(
  "/",
  admitHttpRoute(createSubcategoryRouteOperationDefinition, async (c) => {
    return c.json({});
  }),
);

subcategoryRoutes.get(
  "/",
  admitHttpRead(listSubcategoriesRouteReadDefinition, async (c) => {
    const organizationId = c.req.param("organizationId");
    const storeId = c.req.param("storeId");
    const params = c.req.queries();

    if (!organizationId || !storeId)
      return c.json({ error: "Missing data to retrieve subcategories" }, 400);

    const subcategories = await c.env.runQuery(
      internal.inventory.subcategories.getAllInternal,
      {
        storeId: storeId as Id<"store">,
        categoryId: params.categoryId?.[0] as Id<"category">,
      },
    );

    return c.json({
      subcategories: removeStorefrontHiddenSubcategoryList(subcategories),
    });
  }),
);

subcategoryRoutes.put(
  "/:subcategoryId",
  admitHttpRoute(updateSubcategoryRouteOperationDefinition, async (c) => {
    return c.json({});
  }),
);

subcategoryRoutes.get(
  "/:subcategoryId",
  admitHttpRead(getSubcategoryRouteReadDefinition, async (c) => {
    return c.json({});
  }),
);

subcategoryRoutes.delete(
  "/:subcategoryId",
  admitHttpRoute(deleteSubcategoryRouteOperationDefinition, async (c) => {
    return c.json({});
  }),
);

export { subcategoryRoutes };
