import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";

const guestRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Get all bags
guestRoutes.get("/", async (c) => {
  return c.json({});
});

// Create a new guest
guestRoutes.post("/", async (c) => {
  const guest = await c.env.runMutation(api.storeFront.guest.create);

  return c.json({ id: guest });
});

export { guestRoutes };
