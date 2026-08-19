import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";
import {
  awardGuestOrderPointsRouteOperationDefinition,
  awardPastOrderPointsRouteOperationDefinition,
  redeemRewardPointsRouteOperationDefinition,
} from "../../../../operationAdmission/domains/httpCustomer_definitions";
import {
  getEligiblePastOrdersRouteReadDefinition,
  getOrderRewardPointsRouteReadDefinition,
  getRewardHistoryRouteReadDefinition,
  getRewardPointsRouteReadDefinition,
  getRewardTiersRouteReadDefinition,
} from "../../../../operationAdmission/domains/httpCustomer_readDefinitions";
import {
  guestMergeErrorResponse,
  parseIngressJson,
  tryParseIngressJson,
  requireAdmittedCustomerOwner,
} from "./admittedCustomer";

const rewardsRoutes: HonoWithConvex<ActionCtx> = new Hono();

/**
 * Rewards belong to a signed-in account, so every handler branches on
 * `owner.storeFrontUserId`: present means an account, absent means the admitted
 * shopper is still a guest. That replaces the old
 * `userId.toString().startsWith("guest")` string sniff with the claim the rail
 * actually resolved, and the store now comes from the claim row rather than the
 * `store_id` cookie.
 */

// Get user's current points
rewardsRoutes.get(
  "/points",
  admitHttpRead(getRewardPointsRouteReadDefinition, async (c, admitted) => {
    const owner = requireAdmittedCustomerOwner(admitted);
    if (!owner.storeFrontUserId) {
      return c.json({ points: 0 });
    }

    const points = await c.env.runQuery(
      internal.storeFront.rewards.getUserPointsInternal,
      {
        storeFrontUserId: owner.storeFrontUserId,
        storeId: owner.storeId,
        owner,
      },
    );

    return c.json({ points });
  }),
);

// Get user's point history
rewardsRoutes.get(
  "/history",
  admitHttpRead(getRewardHistoryRouteReadDefinition, async (c, admitted) => {
    const owner = requireAdmittedCustomerOwner(admitted);
    if (!owner.storeFrontUserId) {
      return c.json({ transactions: [] });
    }

    const transactions = await c.env.runQuery(
      internal.storeFront.rewards.getPointHistoryInternal,
      {
        storeFrontUserId: owner.storeFrontUserId,
        owner,
      },
    );

    return c.json({ transactions });
  }),
);

// Get available reward tiers
rewardsRoutes.get(
  "/tiers",
  admitHttpRead(getRewardTiersRouteReadDefinition, async (c, admitted) => {
    const owner = requireAdmittedCustomerOwner(admitted);

    const tiers = await c.env.runQuery(
      internal.storeFront.rewards.getTiersInternal,
      { storeId: owner.storeId, owner },
    );

    return c.json({ tiers });
  }),
);

// Redeem points for a reward
rewardsRoutes.post(
  "/redeem",
  admitHttpRoute(
    redeemRewardPointsRouteOperationDefinition,
    async (c, admitted) => {
      const owner = requireAdmittedCustomerOwner(admitted);
      if (!owner.storeFrontUserId) {
        return c.json({ error: "Must be logged in to redeem points" }, 401);
      }

      const { rewardTierId } = parseIngressJson(admitted);
      if (!rewardTierId) {
        return c.json({ error: "Reward tier ID is required" }, 400);
      }

      const result = await c.env.runMutation(
        internal.storeFront.rewards.redeemPointsInternal,
        {
          storeFrontUserId: owner.storeFrontUserId,
          storeId: owner.storeId,
          rewardTierId: rewardTierId as Id<"rewardTiers">,
          owner,
        },
      );

      return c.json(result);
    },
  ),
);

// Add endpoints for past eligible orders and awarding points for them
rewardsRoutes.get(
  "/eligible-past-orders",
  admitHttpRead(
    getEligiblePastOrdersRouteReadDefinition,
    async (c, admitted) => {
      const owner = requireAdmittedCustomerOwner(admitted);
      if (!owner.storeFrontUserId) {
        return c.json(
          { error: "Must be logged in to view eligible orders" },
          401,
        );
      }

      const { email } = c.req.query();
      if (!email) {
        return c.json({ error: "Email is required" }, 400);
      }

      const orders = await c.env.runQuery(
        internal.storeFront.rewards.getPastEligibleOrdersInternal,
        {
          storeFrontUserId: owner.storeFrontUserId,
          email,
          owner,
        },
      );

      return c.json({ orders });
    },
  ),
);

rewardsRoutes.post(
  "/award-past-order",
  admitHttpRoute(
    awardPastOrderPointsRouteOperationDefinition,
    async (c, admitted) => {
      const owner = requireAdmittedCustomerOwner(admitted);
      if (!owner.storeFrontUserId) {
        return c.json({ error: "Must be logged in to award points" }, 401);
      }

      const { orderId } = parseIngressJson(admitted);
      if (!orderId) {
        return c.json({ error: "Order ID is required" }, 400);
      }

      const result = await c.env.runMutation(
        internal.storeFront.rewards.awardPointsForPastOrderInternal,
        {
          storeFrontUserId: owner.storeFrontUserId,
          orderId: orderId as Id<"onlineOrder">,
          owner,
        },
      );

      return c.json(result);
    },
  ),
);

// Add endpoint to get reward points for a specific order
rewardsRoutes.get(
  "/order-points",
  admitHttpRead(
    getOrderRewardPointsRouteReadDefinition,
    async (c, admitted) => {
      const orderId = c.req.query("orderId");

      if (!orderId) {
        return c.json({ error: "Order ID is required" }, 400);
      }

      try {
        // Previously any caller could read any order's points by id. The order
        // is still named by the query string, but the callee now checks it
        // against the admitted shopper.
        const result = await c.env.runQuery(
          internal.storeFront.rewards.getOrderPointsInternal,
          {
            orderId: orderId as Id<"onlineOrder">,
            owner: requireAdmittedCustomerOwner(admitted),
          },
        );

        return c.json(result);
      } catch (error) {
        console.error("Error fetching order points:", error);
        return c.json({ error: "Failed to fetch order points", points: 0 }, 500);
      }
    },
  ),
);

// Add endpoint to award points for all orders associated with a guest ID
rewardsRoutes.post(
  "/award-guest-orders",
  admitHttpRoute(
    awardGuestOrderPointsRouteOperationDefinition,
    async (c, admitted) => {
      // A malformed body is a client error, answered here rather than left to
      // escape as a `SyntaxError` that Convex renders as a server fault. Same
      // shape as the other merge routes (`bag`, `savedBag`, `onlineOrder`).
      const body = tryParseIngressJson(admitted);
      if (!body) {
        return c.json({ error: "Invalid request body" }, 400);
      }
      const { guestId } = body;

      // The account the points land on is the admitted shopper's, never the
      // body's `userId` — that field is no longer read at all.
      const owner = requireAdmittedCustomerOwner(admitted);
      if (!owner.storeFrontUserId) {
        return c.json({ error: "User ID is required" }, 400);
      }

      if (!guestId) {
        return c.json({ error: "Guest ID is required" }, 400);
      }

      try {
        const result = await c.env.runMutation(
          internal.storeFront.rewards.awardPointsForGuestOrdersInternal,
          {
            storeFrontUserId: owner.storeFrontUserId,
            guestId: guestId as Id<"guest">,
            // Reward points are transferable value, so the callee refuses any
            // guest row that does not carry a live server-issued merge grant
            // for this account. The caller forwards no evidence of its own.
            owner,
          },
        );

        return c.json(result);
      } catch (error) {
        // Same rule as the other merge routes — ownership refusal → 403,
        // malformed guest id → 400, anything else propagates as the fault it
        // is (see `guestMergeErrorResponse`). This route had no catch at all,
        // so a refused merge — the common case here — surfaced as a 500.
        const denial = guestMergeErrorResponse(error);
        if (denial) return c.json(denial.body, denial.status);
        throw error;
      }
    },
  ),
);

export { rewardsRoutes };
