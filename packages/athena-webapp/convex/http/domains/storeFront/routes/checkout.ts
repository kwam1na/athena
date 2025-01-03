import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";

const checkoutRoutes: HonoWithConvex<ActionCtx> = new Hono();

checkoutRoutes.get("/", async (c) => {
  return c.json({});
});

checkoutRoutes.post("/", async (c) => {
  const { storeFrontUserId } = await c.req.json();
  return c.json({});
});

checkoutRoutes.delete("/:bagId", async (c) => {
  const { bagId } = c.req.param();
  return c.json({});
});

checkoutRoutes.get("/:bagId/items", async (c) => {
  const { bagId } = c.req.param();
  return c.json({});
});

checkoutRoutes.post("/:bagId/items", async (c) => {
  const { bagId } = c.req.param();
  const { productId, storeFrontUserId, quantity, price } = await c.req.json();

  return c.json({});
});

checkoutRoutes.put("/:bagId/items/:itemId", async (c) => {
  const { bagId, itemId } = c.req.param();
  const { quantity } = await c.req.json();
  return c.json({});
});

checkoutRoutes.delete("/:bagId/items/:itemId", async (c) => {
  const { bagId, itemId } = c.req.param();
  return c.json({});
});

export { checkoutRoutes };
