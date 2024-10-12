import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";

const bagRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Get all bags
bagRoutes.get("/", async (c) => {
  return c.json({});
});

// Get a specific bag
bagRoutes.get("/:bagId", async (c) => {
  const { bagId } = c.req.param();

  if (bagId == "active") {
    const customerId = c.req.param("customerId");
    return c.json({});
  }

  return c.json({});
});

// Create a new bag
bagRoutes.post("/", async (c) => {
  const { customerId } = await c.req.json();
  return c.json({});
});

// Delete a bag
bagRoutes.delete("/:bagId", async (c) => {
  const { bagId } = c.req.param();
  return c.json({});
});

// Get all items in a bag
bagRoutes.get("/:bagId/items", async (c) => {
  const { bagId } = c.req.param();
  return c.json({});
});

bagRoutes.post("/:bagId/items", async (c) => {
  const { bagId } = c.req.param();
  const { productId, customerId, quantity, price } = await c.req.json();

  // Check if the item is already in the bag
  return c.json({});
});

// Update an item in a bag
bagRoutes.put("/:bagId/items/:itemId", async (c) => {
  const { bagId, itemId } = c.req.param();
  const { quantity } = await c.req.json();
  return c.json({});
});

// Delete an item from a bag
bagRoutes.delete("/:bagId/items/:itemId", async (c) => {
  const { bagId, itemId } = c.req.param();
  return c.json({});
});

export { bagRoutes };
