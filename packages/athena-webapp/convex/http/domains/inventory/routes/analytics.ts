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

  const { action, origin, data } = await c.req.json();

  if (!storeId || !organizationId) {
    return c.json({ error: "Store or organization id missing" }, 404);
  }

  const res = await c.env.runMutation(api.storeFront.analytics.create, {
    storeId: storeId,
    storeFrontUserId: userId,
    origin,
    action,
    data,
  });

  return c.json(res);
});

export { analyticsRoutes };
