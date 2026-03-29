import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import {
  getStoreDataFromRequest,
  getStorefrontUserFromRequest,
} from "../../../utils";

const userOffersRoutes: HonoWithConvex<ActionCtx> = new Hono();

/**
 * Get offers eligibility for the current user
 * GET /user-offers
 */
userOffersRoutes.get("/", async (c) => {
  try {
    const userId = getStorefrontUserFromRequest(c);

    if (!userId) {
      return c.json({ error: "User ID is required" }, 400);
    }

    // Get store data
    const { storeId } = getStoreDataFromRequest(c);

    if (!storeId) {
      return c.json({ error: "Store ID is required" }, 400);
    }

    // Check the user's eligibility for offers
    const eligibility = await c.env.runQuery(
      api.storeFront.userOffers.getEligibility,
      {
        storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
        storeId: storeId as Id<"store">,
      }
    );

    return c.json(eligibility);
  } catch (error) {
    console.error("Error checking user offers eligibility:", error);
    return c.json({ error: "Failed to check offers eligibility" }, 500);
  }
});

export { userOffersRoutes };
