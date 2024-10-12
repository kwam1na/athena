import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";

const guestRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Get all bags
guestRoutes.get("/", async (c) => {
  return c.json({});
});

// Get a specific bag
guestRoutes.get("/:bagId", async (c) => {
  const { bagId } = c.req.param();

  if (bagId == "active") {
    const customerId = c.req.param("customerId");
    return c.json({});
  }

  return c.json({});
});

// Create a new bag
guestRoutes.post("/", async (c) => {
  const guest = await c.env.runMutation(api.storeFront.guest.create);

  return c.json({ id: guest });
});

// Delete a bag
guestRoutes.delete("/:bagId", async (c) => {
  const { bagId } = c.req.param();
  return c.json({});
});

// Get all items in a bag
guestRoutes.get("/:bagId/items", async (c) => {
  const { bagId } = c.req.param();
  return c.json({});
});

export { guestRoutes };
