import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getCookie } from "hono/cookie";
import { getStorefrontUserFromRequest } from "../../../utils";

const upsellRoutes: HonoWithConvex<ActionCtx> = new Hono();

upsellRoutes.get("/", async (c) => {
  const userId = getStorefrontUserFromRequest(c);

  if (!userId) {
    return c.json(null, 200);
  }

  try {
    const lastProduct = await c.env.runQuery(
      api.storeFront.user.getLastViewedProduct,
      {
        id: userId as Id<"storeFrontUser">,
      }
    );

    return c.json(lastProduct);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

export { upsellRoutes };
