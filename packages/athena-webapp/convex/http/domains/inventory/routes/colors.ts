import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";

const colorRoutes: HonoWithConvex<ActionCtx> = new Hono();

colorRoutes.post("/", async (c) => {
  const data = await c.req.json();

  const color = await c.env.runMutation(api.inventory.colors.create, data);

  return c.json(color);

  // return c.json(newCategory, 201);
});

colorRoutes.get("/", async (c) => {
  const organizationId = c.req.param("organizationId");
  const storeId = c.req.param("storeId");

  if (!organizationId || !storeId)
    return c.json({ error: "Missing data to retrieve colors" }, 400);

  const colors = await c.env.runQuery(api.inventory.colors.getAll, {
    storeId: storeId as Id<"store">,
  });

  return c.json({ colors });
});

colorRoutes.put("/:colorId", async (c) => {
  const { colorId } = c.req.param();

  const data = await c.req.json();

  const updatedColor = await c.env.runMutation(api.inventory.colors.update, {
    id: colorId as Id<"color">,
    name: data.name,
  });

  return c.json(updatedColor);

  // return updatedOrg
  //   ? c.json(updatedOrg)
  //   : c.json({ error: "Yuhh, Not found" }, 404);
});

colorRoutes.get("/:categoryId", async (c) => {
  const { categoryId } = c.req.param();

  // const category = await categoriesRepository.getById(parseInt(categoryId));

  return c.json({});
  // return category ? c.json(category) : c.json({ error: "Yuh, Not found" }, 404);
});

colorRoutes.delete("/:categoryId", async (c) => {
  const { categoryId } = c.req.param();
  // const result = await categoriesRepository.delete(parseInt(categoryId));
  // return result
  //   ? c.json({ message: "Deleted" })
  //   : c.json({ error: "Not found" }, 404);

  return c.json({});
});

export { colorRoutes };
