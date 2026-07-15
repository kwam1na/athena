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
import { isAuthorizedResourceOwner } from "./security";

const rewardsRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Get user's current points
rewardsRoutes.get("/points", async (c) => {
  const userId = getStorefrontUserFromRequest(c);
  if (!userId || userId.toString().startsWith("guest")) {
    return c.json({ points: 0 });
  }

  const { storeId } = getStoreDataFromRequest(c);

  if (!storeId) {
    return c.json({ error: "Store ID is required" }, 400);
  }

  const points = await c.env.runQuery(api.storeFront.rewards.getUserPoints, {
    storeFrontUserId: userId as Id<"storeFrontUser">,
    storeId: storeId as Id<"store">,
  });

  return c.json({ points });
});

// Get user's point history
rewardsRoutes.get("/history", async (c) => {
  const userId = getStorefrontUserFromRequest(c);
  if (!userId || userId.toString().startsWith("guest")) {
    return c.json({ transactions: [] });
  }

  const transactions = await c.env.runQuery(
    api.storeFront.rewards.getPointHistory,
    {
      storeFrontUserId: userId as Id<"storeFrontUser">,
    }
  );

  return c.json({ transactions });
});

// Get available reward tiers
rewardsRoutes.get("/tiers", async (c) => {
  const { storeId } = getStoreDataFromRequest(c);
  if (!storeId) {
    return c.json({ error: "Store ID is required" }, 400);
  }

  const tiers = await c.env.runQuery(api.storeFront.rewards.getTiers, {
    storeId: storeId as Id<"store">,
  });

  return c.json({ tiers });
});

// Redeem points for a reward
rewardsRoutes.post("/redeem", async (c) => {
  const userId = getStorefrontUserFromRequest(c);
  if (!userId || userId.toString().startsWith("guest")) {
    return c.json({ error: "Must be logged in to redeem points" }, 401);
  }

  const { storeId } = getStoreDataFromRequest(c);
  if (!storeId) {
    return c.json({ error: "Store ID is required" }, 400);
  }

  const { rewardTierId } = await c.req.json();
  if (!rewardTierId) {
    return c.json({ error: "Reward tier ID is required" }, 400);
  }

  const result = await c.env.runMutation(api.storeFront.rewards.redeemPoints, {
    storeFrontUserId: userId as Id<"storeFrontUser">,
    storeId: storeId as Id<"store">,
    rewardTierId: rewardTierId as Id<"rewardTiers">,
  });

  return c.json(result);
});

// Add endpoints for past eligible orders and awarding points for them
rewardsRoutes.get("/eligible-past-orders", async (c) => {
  const userId = getStorefrontUserFromRequest(c);
  if (!userId || userId.toString().startsWith("guest")) {
    return c.json({ error: "Must be logged in to view eligible orders" }, 401);
  }

  const { email } = await c.req.query();
  if (!email) {
    return c.json({ error: "Email is required" }, 400);
  }

  const orders = await c.env.runQuery(
    api.storeFront.rewards.getPastEligibleOrders,
    {
      storeFrontUserId: userId as Id<"storeFrontUser">,
      email,
    }
  );

  return c.json({ orders });
});

rewardsRoutes.post("/award-past-order", async (c) => {
  const userId = getStorefrontUserFromRequest(c);
  if (!userId || userId.toString().startsWith("guest")) {
    return c.json({ error: "Must be logged in to award points" }, 401);
  }

  const { orderId } = await c.req.json();
  if (!orderId) {
    return c.json({ error: "Order ID is required" }, 400);
  }

  const result = await c.env.runMutation(
    api.storeFront.rewards.awardPointsForPastOrder,
    {
      storeFrontUserId: userId as Id<"storeFrontUser">,
      orderId: orderId as Id<"onlineOrder">,
    }
  );

  return c.json(result);
});

// Add endpoint to get reward points for a specific order
rewardsRoutes.get("/order-points", async (c) => {
  const orderId = c.req.query("orderId");

  if (!orderId) {
    return c.json({ error: "Order ID is required" }, 400);
  }

  const userId = getStorefrontUserFromRequest(c);
  if (!userId) {
    return c.json({ error: "User id missing" }, 401);
  }

  // Only the order owner may read its points (order IDs are client-visible).
  const order = await c.env.runQuery(api.storeFront.onlineOrder.get, {
    identifier: orderId as Id<"onlineOrder">,
  });

  if (!order) {
    return c.json({ error: "Order not found" }, 404);
  }

  if (!isAuthorizedResourceOwner(order.storeFrontUserId, userId)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  try {
    const result = await c.env.runQuery(api.storeFront.rewards.getOrderPoints, {
      orderId: orderId as Id<"onlineOrder">,
    });

    return c.json(result);
  } catch (error) {
    console.error("Error fetching order points:", error);
    return c.json({ error: "Failed to fetch order points", points: 0 }, 500);
  }
});

// Add endpoint to award points for all orders associated with a guest ID
rewardsRoutes.post("/award-guest-orders", async (c) => {
  const { guestId, userId } = await c.req.json();

  if (!userId) {
    return c.json({ error: "User ID is required" }, 400);
  }

  if (!guestId) {
    return c.json({ error: "Guest ID is required" }, 400);
  }

  // Points may only be awarded to the authenticated user's own account, and
  // only for guest orders belonging to that session's guest cookie.
  const authedUserId = getCookie(c, "user_id");
  const authedGuestId = getCookie(c, "guest_id");
  if (!isAuthorizedResourceOwner(userId, authedUserId)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  if (!isAuthorizedResourceOwner(guestId, authedGuestId)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const result = await c.env.runMutation(
    api.storeFront.rewards.awardPointsForGuestOrders,
    {
      storeFrontUserId: userId as Id<"storeFrontUser">,
      guestId: guestId as Id<"guest">,
    }
  );

  return c.json(result);
});

export { rewardsRoutes };
