import { Hono } from "hono";
import { storeRepository } from "@athena/db";

const storeRoutes = new Hono();

storeRoutes.post("/", async (c) => {
  const data = await c.req.json();

  const newStore = await storeRepository.create(data);

  return c.json(newStore, 201);
});

storeRoutes.get("/", async (c) => {
  const organizationId = c.req.param("organizationId");

  const stores = await storeRepository.getAll(parseInt(organizationId!));

  return c.json({ stores });
});

storeRoutes.put("/:storeId", async (c) => {
  const { storeId } = c.req.param();

  const data = await c.req.json();

  const updatedStore = await storeRepository.update(parseInt(storeId), data);

  return updatedStore
    ? c.json(updatedStore)
    : c.json({ error: "Yuhh, Not found" }, 404);
});

storeRoutes.get("/:storeId", async (c) => {
  const { storeId } = c.req.param();

  const org = await storeRepository.getById(parseInt(storeId));

  return org ? c.json(org) : c.json({ error: "Yuh, Not found" }, 404);
});

storeRoutes.delete("/:storeId", async (c) => {
  const { storeId } = c.req.param();

  const result = await storeRepository.delete(parseInt(storeId));

  return result
    ? c.json({ message: "Deleted" })
    : c.json({ error: "Not found" }, 404);
});

export { storeRoutes };
