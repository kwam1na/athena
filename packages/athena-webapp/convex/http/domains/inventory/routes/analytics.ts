import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
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

  const { action, origin, data, productId } = await c.req.json();

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
    productId,
  });

  return c.json(res);
});

// Endpoint for updating analytics owner from guest to registered user
analyticsRoutes.post("/update-owner", async (c) => {
  try {
    const { guestId, userId } = await c.req.json();

    if (!guestId || !userId) {
      return c.json({ error: "Guest ID and User ID are required" }, 400);
    }

    // Add a mutation to update all analytics records associated with guestId to userId
    await c.env.runMutation(api.storeFront.analytics.updateOwner, {
      guestId: guestId as Id<"guest">,
      userId: userId as Id<"storeFrontUser">,
    });

    return c.json({ success: true });
  } catch (error) {
    console.error("Error updating analytics owner:", error);
    return c.json(
      { error: "Failed to update analytics owner", details: String(error) },
      500
    );
  }
});

// New: GET /product-view-count?productId=...
analyticsRoutes.get("/product-view-count", async (c) => {
  const productId = c.req.query("productId");
  if (!productId) {
    return c.json({ error: "Missing productId" }, 400);
  }
  const count = await c.env.runQuery(
    api.storeFront.analytics.getProductViewCount,
    {
      productId: productId as Id<"product">,
    }
  );

  return c.json(count);
});

export { analyticsRoutes };
