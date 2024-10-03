import { Hono } from "hono";
import { subcategoriesRepository } from "@athena/db";

const subcategoryRoutes = new Hono();

subcategoryRoutes.post("/", async (c) => {
  const data = await c.req.json();

  const newSubcategory = await subcategoriesRepository.create(data);

  return c.json(newSubcategory, 201);
});

subcategoryRoutes.get("/", async (c) => {
  const organizationId = c.req.param("organizationId");
  const storeId = c.req.param("storeId");

  if (!organizationId || !storeId)
    return c.json({ error: "Missing data to retrieve subcategories" }, 400);

  const subcategories = await subcategoriesRepository.getAll(
    parseInt(storeId),
    parseInt(organizationId)
  );

  return c.json({ subcategories });
});

subcategoryRoutes.put("/:subcategoryId", async (c) => {
  const { subcategoryId } = c.req.param();

  const data = await c.req.json();

  const updatedSubcategory = await subcategoriesRepository.update(
    parseInt(subcategoryId),
    data
  );

  return updatedSubcategory
    ? c.json(updatedSubcategory)
    : c.json({ error: "Yuhh, Not found" }, 404);
});

subcategoryRoutes.get("/:subcategoryId", async (c) => {
  const { subcategoryId } = c.req.param();

  const org = await subcategoriesRepository.getById(parseInt(subcategoryId));

  return org ? c.json(org) : c.json({ error: "Yuh, Not found" }, 404);
});

subcategoryRoutes.delete("/:subcategoryId", async (c) => {
  const { subcategoryId } = c.req.param();
  const result = await subcategoriesRepository.delete(parseInt(subcategoryId));
  return result
    ? c.json({ message: "Deleted" })
    : c.json({ error: "Not found" }, 404);
});

export { subcategoryRoutes };
