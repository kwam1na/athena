import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";

const guestRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Get all bags
guestRoutes.get("/:guestId", async (c) => {
  const { guestId } = c.req.param();

  const guest = await c.env.runQuery(api.storeFront.guest.getById, {
    id: guestId as Id<"guest">,
  });

  return c.json(guest);
});

// Create a new guest
guestRoutes.post("/", async (c) => {
  const guest = await c.env.runMutation(api.storeFront.guest.create);

  return c.json({ id: guest });
});

export { guestRoutes };
