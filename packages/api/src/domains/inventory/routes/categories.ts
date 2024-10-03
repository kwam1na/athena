import { Hono } from "hono";
import { categoriesRepository } from "@athena/db";

const categoryRoutes = new Hono();

categoryRoutes.post("/", async (c) => {
  const data = await c.req.json();

  const newCategory = await categoriesRepository.create(data);

  return c.json(newCategory, 201);
});

categoryRoutes.get("/", async (c) => {
  const organizationId = c.req.param("organizationId");
  const storeId = c.req.param("storeId");

  if (!organizationId || !storeId)
    return c.json({ error: "Missing data to retrieve categories" }, 400);

  const categories = await categoriesRepository.getAll(
    parseInt(storeId),
    parseInt(organizationId)
  );

  return c.json({ categories });
});

categoryRoutes.put("/:categoryId", async (c) => {
  const { categoryId } = c.req.param();

  const data = await c.req.json();

  const updatedOrg = await categoriesRepository.update(
    parseInt(categoryId),
    data
  );

  return updatedOrg
    ? c.json(updatedOrg)
    : c.json({ error: "Yuhh, Not found" }, 404);
});

categoryRoutes.get("/:categoryId", async (c) => {
  const { categoryId } = c.req.param();

  const category = await categoriesRepository.getById(parseInt(categoryId));

  return category ? c.json(category) : c.json({ error: "Yuh, Not found" }, 404);
});

categoryRoutes.delete("/:categoryId", async (c) => {
  const { categoryId } = c.req.param();
  const result = await categoriesRepository.delete(parseInt(categoryId));
  return result
    ? c.json({ message: "Deleted" })
    : c.json({ error: "Not found" }, 404);
});

export { categoryRoutes };
