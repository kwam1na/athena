import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getStoreDataFromRequest } from "../../../utils";

const categoryRoutes: HonoWithConvex<ActionCtx> = new Hono();

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

    return c.json({ categories });
  }

  const categories = await c.env.runQuery(api.inventory.categories.getAll, {
    storeId: storeId as Id<"store">,
  });

  return c.json({ categories });
});

export { categoryRoutes };
