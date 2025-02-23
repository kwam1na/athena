import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api, internal } from "../../../../_generated/api";
import {
  getStoreDataFromRequest,
  getStorefrontUserFromRequest,
} from "../../../utils";
import { Id } from "../../../../_generated/dataModel";

const checkoutRoutes: HonoWithConvex<ActionCtx> = new Hono();

checkoutRoutes.post("/", async (c) => {
  const { storeId } = getStoreDataFromRequest(c);
  const userId = getStorefrontUserFromRequest(c);

  if (!userId) {
    return c.json({ error: "Customer id missing" }, 404);
  }

  if (!storeId) {
    return c.json({ error: "Store id missing" }, 404);
  }

  const { products, bagId, amount } = await c.req.json();

  try {
    const session = await c.env.runMutation(
      api.storeFront.checkoutSession.create,
      {
        storeId: storeId as Id<"store">,
        storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
        products,
        bagId,
        amount,
      }
    );

    return c.json(session);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

checkoutRoutes.post("/:checkoutSessionId", async (c) => {
  const { checkoutSessionId } = c.req.param();

  const userId = getStorefrontUserFromRequest(c);
  const { storeId, organizationId } = getStoreDataFromRequest(c);

  if (!userId) {
    return c.json({ error: "Customer id missing" }, 404);
  }

  if (!storeId || !organizationId) {
    return c.json({ error: "Store or organization id missing" }, 404);
  }

  const {
    customerEmail,
    amount,
    hasCompletedCheckoutSession,
    action,
    orderDetails,
    placedOrderId,
  } = await c.req.json();

  try {
    if (action == "finalize-payment") {
      // check that the store is still active
      const store = await c.env.runQuery(api.inventory.stores.getByIdOrSlug, {
        identifier: storeId,
        organizationId: organizationId as Id<"organization">,
      });

      const { config } = store || {};

      if (
        config?.availability?.inMaintenanceMode ||
        config?.visibility?.inReadOnlyMode
      ) {
        return c.json({
          success: false,
          message: "Store checkout not available",
        });
      }

      const payment = await c.env.runAction(
        api.storeFront.payment.createTransaction,
        {
          customerEmail,
          amount,
          checkoutSessionId: checkoutSessionId as Id<"checkoutSession">,
          orderDetails: {
            ...orderDetails,
            deliveryDetails: orderDetails.deliveryDetails ?? null,
          },
        }
      );

      return c.json(payment);
    }

    if (action == "complete-checkout") {
      const res = await c.env.runMutation(
        internal.storeFront.checkoutSession.updateCheckoutSession,
        {
          id: checkoutSessionId as Id<"checkoutSession">,
          hasCompletedCheckoutSession,
          orderDetails: {
            ...orderDetails,
            deliveryDetails: orderDetails.deliveryDetails ?? null,
          },
        }
      );

      return c.json(res);
    }

    if (action == "place-order") {
      const res = await c.env.runMutation(
        internal.storeFront.checkoutSession.updateCheckoutSession,
        {
          id: checkoutSessionId as Id<"checkoutSession">,
          hasCompletedCheckoutSession,
          action,
        }
      );

      return c.json(res);
    }

    if (action == "cancel-order") {
      const res = await c.env.runAction(
        api.storeFront.checkoutSession.cancelOrder,
        {
          id: checkoutSessionId as Id<"checkoutSession">,
        }
      );

      return c.json(res);
    }

    if (action == "update-order") {
      const res = await c.env.runMutation(
        internal.storeFront.checkoutSession.updateCheckoutSession,
        {
          id: checkoutSessionId as Id<"checkoutSession">,
          placedOrderId,
          hasCompletedCheckoutSession,
        }
      );

      return c.json(res);
    }

    return c.json({});
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

checkoutRoutes.get("/active", async (c) => {
  const userId = getStorefrontUserFromRequest(c);

  if (!userId) {
    return c.json({ error: "Customer id missing" }, 404);
  }

  try {
    const session = await c.env.runQuery(
      api.storeFront.checkoutSession.getActiveCheckoutSession,
      {
        storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
      }
    );

    return c.json(session);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

checkoutRoutes.get("/pending", async (c) => {
  const userId = getStorefrontUserFromRequest(c);

  if (!userId) {
    return c.json({ error: "Customer id missing" }, 404);
  }

  const session = await c.env.runQuery(
    api.storeFront.checkoutSession.getPendingCheckoutSessions,
    { storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest"> }
  );

  return c.json(session);
});

checkoutRoutes.get("/:sessionId", async (c) => {
  const { sessionId } = c.req.param();

  const session = await c.env.runQuery(api.storeFront.checkoutSession.getById, {
    sessionId: sessionId as Id<"checkoutSession">,
  });

  return c.json(session);
});

checkoutRoutes.get("/verify/:reference", async (c) => {
  const { reference } = c.req.param();

  const userId = getStorefrontUserFromRequest(c);

  if (!userId) {
    return c.json({ error: "Customer id missing" }, 404);
  }

  const res = await c.env.runAction(api.storeFront.payment.verifyPayment, {
    storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
    externalReference: reference,
  });

  return c.json(res);
});

export { checkoutRoutes };
