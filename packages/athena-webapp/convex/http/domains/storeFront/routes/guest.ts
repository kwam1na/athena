import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getCookie, deleteCookie, setCookie } from "hono/cookie";
import { getStoreDataFromRequest } from "../../../utils";
import { getActorClaims } from "./actorAuth";

const guestRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Get all bags
guestRoutes.get("/", async (c) => {
  const guestId = getCookie(c, "guest_id");
  const claims = await getActorClaims(c);

  const marker = c.req.query("marker");

  const { storeId, organizationId } = await getStoreDataFromRequest(c);

  const actorGuestId =
    claims?.actorType === "guest" ? (claims.actorId as Id<"guest">) : undefined;

  if (!guestId && !actorGuestId) {
    return c.json({ error: "Guest id missing" }, 404);
  }

  try {
    const guest = await c.env.runQuery(api.storeFront.guest.getById, {
      id: (guestId || actorGuestId) as Id<"guest">,
    });

    return c.json(guest);
  } catch (e) {
    if ((e as Error).message.includes("ArgumentValidationError")) {
      let guest = await c.env.runQuery(api.storeFront.guest.getByMarker, {
        marker,
      });

      if (!guest) {
        guest = await c.env.runMutation(api.storeFront.guest.create, {
          marker,
          creationOrigin: "storefront",
          storeId,
          organizationId,
        });
      }

      if (guest) {
        setCookie(c, "guest_id", guest?._id, {
          path: "/",
          secure: true,
          domain: "wigclub.store",
          httpOnly: true,
          sameSite: "None",
          maxAge: 90 * 24 * 60 * 60, // 90 days in seconds
        });

        c.header("Access-Control-Allow-Origin", "https://wigclub.store");
        c.header("Access-Control-Allow-Credentials", "true");
      }

      return c.json(guest);
    }
  }
});

guestRoutes.put("/", async (c) => {
  const guestId = getCookie(c, "guest_id");
  const claims = await getActorClaims(c);
  const actorGuestId =
    claims?.actorType === "guest" ? (claims.actorId as Id<"guest">) : undefined;

  const { email, firstName, lastName, phoneNumber } = await c.req.json();

  const guest = await c.env.runMutation(api.storeFront.guest.update, {
    id: (guestId || actorGuestId) as Id<"guest">,
    email,
    firstName,
    lastName,
    phoneNumber,
  });

  return c.json(guest);
});

// Create a new guest
guestRoutes.post("/", async (c) => {
  const guest = await c.env.runMutation(api.storeFront.guest.create, {});

  return c.json({ id: guest });
});

export { guestRoutes };
