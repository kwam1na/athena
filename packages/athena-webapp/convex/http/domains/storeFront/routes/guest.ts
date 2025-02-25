import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getCookie, deleteCookie, setCookie } from "hono/cookie";

const guestRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Get all bags
guestRoutes.get("/", async (c) => {
  const guestId = getCookie(c, "guest_id");

  if (!guestId) {
    return c.json({ error: "Guest id missing" }, 404);
  }

  try {
    const guest = await c.env.runQuery(api.storeFront.guest.getById, {
      id: guestId as Id<"guest">,
    });

    return c.json(guest);
  } catch (e) {
    if ((e as Error).message.includes("ArgumentValidationError")) {
      const newGuestId = await c.env.runMutation(
        api.storeFront.guest.create,
        {}
      );

      const g = await c.env.runQuery(api.storeFront.guest.getById, {
        id: newGuestId,
      });

      setCookie(c, "guest_id", newGuestId, {
        path: "/",
        secure: true,
        domain: "wigclub.store",
        httpOnly: true,
        sameSite: "None",
        maxAge: 90 * 24 * 60 * 60, // 90 days in seconds
      });

      c.header("Access-Control-Allow-Origin", "https://wigclub.store");
      c.header("Access-Control-Allow-Credentials", "true");

      return c.json(g);
    }
  }
});

// Create a new guest
guestRoutes.post("/", async (c) => {
  const guest = await c.env.runMutation(api.storeFront.guest.create);

  return c.json({ id: guest });
});

export { guestRoutes };
