import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { setCookie, getCookie } from "hono/cookie";
import { getStorefrontUserFromRequest } from "../../../utils";

const storefrontRoutes: HonoWithConvex<ActionCtx> = new Hono();

storefrontRoutes.get("/", async (c) => {
  const storeName = c.req.query("storeName");

  if (!storeName) {
    return c.json({ error: "Store name missing" }, 404);
  }

  const store = await c.env.runQuery(api.inventory.stores.findByName, {
    name: storeName,
  });

  const userId = getStorefrontUserFromRequest(c);

  if (!userId) {
    const guestId = await c.env.runMutation(api.storeFront.guest.create, {});
    setCookie(c, "guest_id", guestId, {
      path: "/",
      secure: true,
      domain: "wigclub.store",
      httpOnly: true,
      sameSite: "None",
      maxAge: 90 * 24 * 60 * 60, // 90 days in seconds
    });
  }

  if (store) {
    setCookie(c, "organization_id", store.organizationId, {
      path: "/",
      secure: true,
      domain: "wigclub.store",
      httpOnly: true,
      sameSite: "None",
      maxAge: 90 * 24 * 60 * 60, // 90 days in seconds
    });

    setCookie(c, "store_id", store._id, {
      path: "/",
      secure: true,
      domain: "wigclub.store",
      httpOnly: true,
      sameSite: "None",
      maxAge: 90 * 24 * 60 * 60, // 90 days in seconds
    });
  }

  c.header("Access-Control-Allow-Origin", "https://wigclub.store");
  c.header("Access-Control-Allow-Credentials", "true");

  return c.json(store);
});

export { storefrontRoutes };
