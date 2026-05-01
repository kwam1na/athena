import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getCookie } from "hono/cookie";
import {
  getStoreDataFromRequest,
  getStorefrontUserFromRequest,
} from "../../../utils";
import { z } from "zod";

const offersRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Email validation with Zod
const emailSchema = z
  .string()
  .email("Invalid email address")
  .refine((value) => value.trim().length > 0, "Email cannot be empty");

/**
 * Create a new offer request
 * POST /offers
 */
offersRoutes.post("/", async (c) => {
  try {
    // Extract guest ID from cookie
    const guestId = getStorefrontUserFromRequest(c);

    if (!guestId) {
      return c.json({ error: "Guest ID is required" }, 400);
    }

    // Get store data
    const { storeId } = getStoreDataFromRequest(c);

    if (!storeId) {
      return c.json({ error: "Store ID is required" }, 400);
    }

    // Get request body
    const body = await c.req.json();
    const { email, promoCodeId } = body;

    // Validate required fields
    if (!email || !promoCodeId) {
      return c.json({ error: "Email and promo code ID are required" }, 400);
    }

    // Validate email format
    try {
      emailSchema.parse(email);
    } catch (error) {
      return c.json({ error: "Invalid email address" }, 400);
    }

    // Get client IP address for rate limiting
    const ipAddress =
      c.req.header("x-forwarded-for") || c.req.header("x-real-ip");

    // Create the offer
    const result = await c.env.runMutation(api.storeFront.offers.create, {
      email,
      promoCodeId: promoCodeId as Id<"promoCode">,
      storeFrontUserId: guestId as Id<"guest"> | Id<"storeFrontUser">,
      storeId: storeId as Id<"store">,
      ipAddress,
    });

    if (!result.success) {
      return c.json({ error: result.message }, 400);
    }

    return c.json(result);
  } catch (error) {
    console.error("Failed to create offer:", error);
    return c.json({ error: "Failed to create offer" }, 500);
  }
});

offersRoutes.get("/", async (c) => {
  try {
    const guestId = getStorefrontUserFromRequest(c);

    if (!guestId) {
      return c.json({ error: "Guest ID is required" }, 400);
    }

    const result = await c.env.runQuery(
      api.storeFront.offers.getByStorefrontUserId,
      {
        storeFrontUserId: guestId as Id<"guest"> | Id<"storeFrontUser">,
      }
    );

    return c.json(result);
  } catch (error) {
    console.error("Failed to get offers:", error);
    return c.json({ error: "Failed to get offers" }, 500);
  }
});

export { offersRoutes };
