import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";

const subcategoryRoutes: HonoWithConvex<ActionCtx> = new Hono();

subcategoryRoutes.post("/", async (c) => {
  const data = await c.req.json();

  return c.json({});
});

subcategoryRoutes.get("/", async (c) => {
  const organizationId = c.req.param("organizationId");
  const storeId = c.req.param("storeId");
  const params = c.req.queries();

  if (!organizationId || !storeId)
    return c.json({ error: "Missing data to retrieve subcategories" }, 400);

  const subcategories = await c.env.runQuery(
    api.inventory.subcategories.getAll,
    {
      storeId: storeId as Id<"store">,
      categoryId: params.categoryId?.[0] as Id<"category">,
    }
  );

  return c.json({ subcategories });
});

subcategoryRoutes.put("/:subcategoryId", async (c) => {
  const { subcategoryId } = c.req.param();

  const data = await c.req.json();

  return c.json({});
});

subcategoryRoutes.get("/:subcategoryId", async (c) => {
  const { subcategoryId } = c.req.param();

  return c.json({});
});

subcategoryRoutes.delete("/:subcategoryId", async (c) => {
  const { subcategoryId } = c.req.param();
  return c.json({});
});

export { subcategoryRoutes };
