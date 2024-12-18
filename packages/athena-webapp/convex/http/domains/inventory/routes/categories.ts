import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";

const categoryRoutes: HonoWithConvex<ActionCtx> = new Hono();

categoryRoutes.post("/", async (c) => {
  const data = await c.req.json();

  return c.json({});

  // return c.json(newCategory, 201);
});

categoryRoutes.get("/", async (c) => {
  const organizationId = c.req.param("organizationId");
  const storeId = c.req.param("storeId");

  const queryParams = c.req.queries();

  if (!organizationId || !storeId)
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

categoryRoutes.put("/:categoryId", async (c) => {
  const { categoryId } = c.req.param();

  const data = await c.req.json();

  // const updatedOrg = await categoriesRepository.update(
  //   parseInt(categoryId),
  //   data
  // );

  return c.json({});

  // return updatedOrg
  //   ? c.json(updatedOrg)
  //   : c.json({ error: "Yuhh, Not found" }, 404);
});

categoryRoutes.get("/:categoryId", async (c) => {
  const { categoryId } = c.req.param();

  // const category = await categoriesRepository.getById(parseInt(categoryId));

  return c.json({});
  // return category ? c.json(category) : c.json({ error: "Yuh, Not found" }, 404);
});

categoryRoutes.delete("/:categoryId", async (c) => {
  const { categoryId } = c.req.param();
  // const result = await categoriesRepository.delete(parseInt(categoryId));
  // return result
  //   ? c.json({ message: "Deleted" })
  //   : c.json({ error: "Not found" }, 404);

  return c.json({});
});

export { categoryRoutes };
