import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getCookie } from "hono/cookie";
import { getStorefrontUserFromRequest } from "../../../utils";
import { isAuthorizedResourceOwner } from "./security";

const onlineOrderRoutes: HonoWithConvex<ActionCtx> = new Hono();

onlineOrderRoutes.get("/", async (c) => {
  const userId = getStorefrontUserFromRequest(c);

  if (!userId) {
    return c.json({ error: "User id missing" }, 404);
  }

  const orders = await c.env.runQuery(api.storeFront.onlineOrder.getAll, {
    storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
  });

  return c.json(orders);
});

onlineOrderRoutes.get("/:orderId", async (c) => {
  const { orderId } = c.req.param();
  const userId = getStorefrontUserFromRequest(c);

  if (!userId) {
    return c.json({ error: "User id missing" }, 404);
  }

  const order = await c.env.runQuery(api.storeFront.onlineOrder.get, {
    identifier: orderId as Id<"onlineOrder">,
  });

  if (!order) {
    return c.json({ error: "Order not found" }, 404);
  }

  if (!isAuthorizedResourceOwner(order.storeFrontUserId, userId)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  return c.json(order);
});

// Update the owner of the bag
onlineOrderRoutes.post("/owner", async (c) => {
  try {
    const { currentOwnerId, newOwnerId } = await c.req.json();

    // Only the authenticated user may claim their OWN prior guest session's
    // orders into their account: the target must be this session's user cookie
    // and the source must be this session's guest cookie. Without both checks
    // an attacker could reassign an arbitrary guest's orders to themselves.
    const authedUserId = getCookie(c, "user_id");
    const authedGuestId = getCookie(c, "guest_id");
    if (
      !isAuthorizedResourceOwner(newOwnerId, authedUserId) ||
      !isAuthorizedResourceOwner(currentOwnerId, authedGuestId)
    ) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const b = await c.env.runMutation(api.storeFront.onlineOrder.updateOwner, {
      currentOwner: currentOwnerId as Id<"guest">,
      newOwner: newOwnerId as Id<"storeFrontUser">,
    });
    return c.json(b);
  } catch (e) {
    console.error(e);
    return c.json({ error: "Internal server error" }, 400);
  }
});

export { onlineOrderRoutes };
