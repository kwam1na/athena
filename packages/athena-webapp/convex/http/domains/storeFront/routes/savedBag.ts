import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";

const savedBagRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Get all bags
savedBagRoutes.get("/", async (c) => {
  return c.json({});
});

// Get a specific bag
savedBagRoutes.get("/:savedBagId", async (c) => {
  const { savedBagId } = c.req.param();

  if (savedBagId == "active") {
    const customerId = c.req.param("customerId");
    return c.json({});
  }

  return c.json({});
});

// Create a new bag
savedBagRoutes.post("/", async (c) => {
  const { customerId } = await c.req.json();
  return c.json({});
});

// Delete a bag
savedBagRoutes.delete("/:savedBagId", async (c) => {
  const { savedBagId } = c.req.param();
  return c.json({});
});

// Get all items in a bag
savedBagRoutes.get("/:savedBagId/items", async (c) => {
  const { savedBagId } = c.req.param();
  return c.json({});
});

savedBagRoutes.post("/:savedBagId/items", async (c) => {
  const { savedBagId } = c.req.param();
  const { productId, customerId, quantity, price } = await c.req.json();

  // Check if the item is already in the bag
  return c.json({});
});

// Update an item in a bag
savedBagRoutes.put("/:savedBagId/items/:itemId", async (c) => {
  const { savedBagId, itemId } = c.req.param();
  const { quantity } = await c.req.json();
  return c.json({});
});

// Delete an item from a bag
savedBagRoutes.delete("/:savedBagId/items/:itemId", async (c) => {
  const { savedBagId, itemId } = c.req.param();
  return c.json({});
});

export { savedBagRoutes };
