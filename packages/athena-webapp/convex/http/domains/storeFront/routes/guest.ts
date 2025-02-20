import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getCookie } from "hono/cookie";

const guestRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Get all bags
guestRoutes.get("/", async (c) => {
  const guestId = getCookie(c, "guest_id");

  if (!guestId) {
    return c.json({ error: "Guest id missing" }, 404);
  }

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
