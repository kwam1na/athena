import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import {
  getStoreDataFromRequest,
  getStorefrontUserFromRequest,
} from "../../../utils";

const analyticsRoutes: HonoWithConvex<ActionCtx> = new Hono();

analyticsRoutes.post("/", async (c) => {
  const { storeId, organizationId } = getStoreDataFromRequest(c);

  const userId = getStorefrontUserFromRequest(c);

  if (!userId) {
    return c.json({ error: "Customer id missing" }, 400);
  }

  const userAgent = c.req.header("user-agent") || "";
  const isMobile = /mobile|android|iphone|ipad|ipod/i.test(userAgent);

  const { action, origin, data } = await c.req.json();

  if (!storeId || !organizationId) {
    return c.json({ error: "Store or organization id missing" }, 400);
  }

  const res = await c.env.runMutation(api.storeFront.analytics.create, {
    storeId: storeId,
    storeFrontUserId: userId,
    origin,
    action,
    data,
    device: isMobile ? "mobile" : "desktop",
  });

  return c.json(res);
});

export { analyticsRoutes };
