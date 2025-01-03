import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api, internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";

const storeRoutes: HonoWithConvex<ActionCtx> = new Hono();

storeRoutes.post("/", async (c) => {
  const data = await c.req.json();

  return c.json({});
});

storeRoutes.get("/", async (c) => {
  const organizationId = c.req.param("organizationId");

  return c.json({});
});

storeRoutes.get("/:storeId", async (c) => {
  const { storeId } = c.req.param();
  const organizationId = c.req.param("organizationId");

  if (!organizationId) {
    return c.json({ error: "Organization id missing" }, 404);
  }

  const store = await c.env.runQuery(api.inventory.stores.getByIdOrSlug, {
    identifier: storeId,
    organizationId: organizationId as Id<"organization">,
  });

  if (!store) {
    return c.json({ error: "Store with identifier not found" }, 400);
  }

  return c.json(store);
});

storeRoutes.put("/:storeId", async (c) => {
  const { storeId } = c.req.param();

  const data = await c.req.json();

  return c.json({});
});

storeRoutes.delete("/:storeId", async (c) => {
  const { storeId } = c.req.param();

  return c.json({});
});

storeRoutes.post("/:storeId/auth/verify", async (c) => {
  const organizationId = c.req.param("organizationId");
  const { storeId } = c.req.param();
  const { email, firstName, lastName, code } = await c.req.json();

  if (code) {
    try {
      const res = await c.env.runMutation(api.storeFront.auth.verifyCode, {
        code,
        email,
        storeId: storeId as Id<"store">,
        organizationId: organizationId as Id<"organization">,
      });

      return c.json(res);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  }

  if (email) {
    const res = await c.env.runAction(
      api.storeFront.auth.sendVerificationCodeViaProvider,
      {
        email,
        firstName,
        lastName,
        storeId: storeId as Id<"store">,
      }
    );

    return c.json(res);
  }

  return c.json({});
});

// users
storeRoutes.get("/:storeId/users", async (c) => {
  return c.json({});
});

// Get a specific bag
storeRoutes.get("/:storeId/users/:userId/bags/:bagId", async (c) => {
  const { bagId, storeId } = c.req.param();

  if (bagId == "active") {
    const userId = c.req.param("userId");

    if (!userId) {
      return c.json({ error: "Customer id missing" }, 404);
    }

    const bag = await c.env.runQuery(api.storeFront.bag.getByUserId, {
      storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
    });

    if (!bag) {
      const b = await c.env.runMutation(api.storeFront.bag.create, {
        storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
        storeId: storeId as Id<"store">,
      });

      return c.json(b);
    }
    return c.json(bag);
  }

  return c.json({});
});

// Create a new bag
storeRoutes.post("/:storeId/users/:userId/bags", async (c) => {
  console.log("hit post bags endpoint");

  const { userId } = await c.req.json();
  return c.json({});
});

// Delete a bag
storeRoutes.delete("/:storeId/users/:userId/bags/:bagId", async (c) => {
  const { bagId } = c.req.param();
  return c.json({});
});

// Get all items in a bag
storeRoutes.get("/:storeId/users/:userId/bags/:bagId/items", async (c) => {
  const { bagId } = c.req.param();
  return c.json({});
});

storeRoutes.post("/:storeId/users/:userId/bags/:bagId/items", async (c) => {
  const { bagId, userId } = c.req.param();
  const { productId, productSkuId, quantity, productSku } = await c.req.json();

  // console.table({ productId, quantity, price });

  const b = await c.env.runMutation(api.storeFront.bagItem.addItemToBag, {
    productId: productId as Id<"product">,
    quantity,
    storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
    bagId: bagId as Id<"bag">,
    productSkuId: productSkuId as Id<"productSku">,
    productSku,
  });

  return c.json(b);
});

// Update the owner of the bag
storeRoutes.post("/:storeId/users/:userId/bags/:bagId/owner", async (c) => {
  console.log("hit endpont...");

  try {
    const { currentOwnerId, newOwnerId } = await c.req.json();

    const b = await c.env.runMutation(api.storeFront.bag.updateOwner, {
      currentOwner: currentOwnerId as Id<"guest">,
      newOwner: newOwnerId as Id<"storeFrontUser">,
    });
    return c.json(b);
  } catch (e) {
    console.error(e);
    return c.json({ error: "Internal server error" }, 400);
  }
});

// Update an item in a bag
storeRoutes.put(
  "/:storeId/users/:userId/bags/:bagId/items/:itemId",
  async (c) => {
    const { itemId } = c.req.param();
    const { quantity } = await c.req.json();

    const b = await c.env.runMutation(api.storeFront.bagItem.updateItemInBag, {
      quantity,
      itemId: itemId as Id<"bagItem">,
    });
    return c.json(b);
  }
);

// Delete an item from a bag
storeRoutes.delete(
  "/:storeId/users/:userId/bags/:bagId/items/:itemId",
  async (c) => {
    const { itemId } = c.req.param();

    await c.env.runMutation(api.storeFront.bagItem.deleteItemFromBag, {
      itemId: itemId as Id<"bagItem">,
    });

    return c.json({ success: true });
  }
);

// Get a specific saved bag
storeRoutes.get("/:storeId/users/:userId/savedBags/:savedBagId", async (c) => {
  const { savedBagId, storeId } = c.req.param();

  if (savedBagId == "active") {
    const userId = c.req.param("userId");

    if (!userId) {
      return c.json({ error: "Customer id missing" }, 404);
    }

    const savedBag = await c.env.runQuery(api.storeFront.savedBag.getByUserId, {
      storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
    });

    if (!savedBag) {
      const b = await c.env.runMutation(api.storeFront.savedBag.create, {
        storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
        storeId: storeId as Id<"store">,
      });

      return c.json(b);
    }
    return c.json(savedBag);
  }

  return c.json({});
});

// Create a new bag
storeRoutes.post("/:storeId/users/:userId/savedBags", async (c) => {
  const { userId } = await c.req.json();
  return c.json({});
});

// Delete a bag
storeRoutes.delete(
  "/:storeId/users/:userId/savedBags/:savedBagId",
  async (c) => {
    const { savedBagId } = c.req.param();
    return c.json({});
  }
);

// Get all items in a saved bag
storeRoutes.get(
  "/:storeId/users/:userId/savedBags/:savedBagId/items",
  async (c) => {
    const { savedBagId } = c.req.param();
    return c.json({});
  }
);

storeRoutes.post(
  "/:storeId/users/:userId/savedBags/:savedBagId/items",
  async (c) => {
    const { savedBagId, userId } = c.req.param();
    const { productId, productSkuId, quantity, productSku } =
      await c.req.json();

    const b = await c.env.runMutation(
      api.storeFront.savedBagItem.addItemToBag,
      {
        productId: productId as Id<"product">,
        quantity,
        storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
        savedBagId: savedBagId as Id<"savedBag">,
        productSkuId: productSkuId as Id<"productSku">,
        productSku,
      }
    );

    return c.json(b);
  }
);

// Update an item in a saved bag
storeRoutes.put(
  "/:storeId/users/:userId/savedBags/:savedBagId/items/:itemId",
  async (c) => {
    const { savedBagId, itemId } = c.req.param();
    const { quantity } = await c.req.json();

    const b = await c.env.runMutation(
      api.storeFront.savedBagItem.updateItemInBag,
      {
        quantity,
        itemId: itemId as Id<"savedBagItem">,
      }
    );
    return c.json(b);
  }
);

// Update the owner of the bag
storeRoutes.post(
  "/:storeId/users/:userId/savedBags/:savedBagId/owner",
  async (c) => {
    try {
      const { currentOwnerId, newOwnerId } = await c.req.json();

      const b = await c.env.runMutation(api.storeFront.savedBag.updateOwner, {
        currentOwner: currentOwnerId as Id<"guest">,
        newOwner: newOwnerId as Id<"storeFrontUser">,
      });
      return c.json(b);
    } catch (e) {
      console.error(e);
      return c.json({ error: "Internal server error" }, 400);
    }
  }
);

// Delete an item from a bag
storeRoutes.delete(
  "/:storeId/users/:userId/savedBags/:savedBagId/items/:itemId",
  async (c) => {
    const { itemId } = c.req.param();

    await c.env.runMutation(
      api.storeFront.savedBagItem.deleteItemFromSavedBag,
      {
        itemId: itemId as Id<"savedBagItem">,
      }
    );

    return c.json({ success: true });
  }
);

storeRoutes.post("/:storeId/users/:userId/checkout", async (c) => {
  const { storeId } = c.req.param();

  const userId = c.req.param("userId");

  if (!userId) {
    return c.json({ error: "Customer id missing" }, 404);
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

storeRoutes.post(
  "/:storeId/users/:userId/checkout/:checkoutSessionId",
  async (c) => {
    const { checkoutSessionId } = c.req.param();

    const userId = c.req.param("userId");

    if (!userId) {
      return c.json({ error: "Customer id missing" }, 404);
    }

    const {
      customerEmail,
      amount,
      hasCompletedCheckoutSession,
      action,
      orderDetails,
    } = await c.req.json();

    try {
      if (action == "finalize-payment") {
        const payment = await c.env.runAction(
          api.storeFront.payment.createTransaction,
          {
            customerEmail,
            amount,
            checkoutSessionId: checkoutSessionId as Id<"checkoutSession">,
            orderDetails,
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
            orderDetails,
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

      return c.json({});
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  }
);

storeRoutes.get("/:storeId/users/:userId/checkout/active", async (c) => {
  const { userId } = c.req.param();

  const session = await c.env.runQuery(
    api.storeFront.checkoutSession.getActiveCheckoutSession,
    {
      storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
    }
  );

  return c.json(session);
});

storeRoutes.get("/:storeId/users/:userId/checkout/pending", async (c) => {
  const { userId } = c.req.param();

  const session = await c.env.runQuery(
    api.storeFront.checkoutSession.getPendingCheckoutSessions,
    { storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest"> }
  );

  return c.json(session);
});

storeRoutes.get("/:storeId/users/:userId/checkout/:sessionId", async (c) => {
  const { sessionId } = c.req.param();

  const session = await c.env.runQuery(api.storeFront.checkoutSession.getById, {
    sessionId: sessionId as Id<"checkoutSession">,
  });

  return c.json(session);
});

storeRoutes.get(
  "/:storeId/users/:userId/checkout/verify/:reference",
  async (c) => {
    const { userId, reference } = c.req.param();

    const res = await c.env.runAction(api.storeFront.payment.verifyPayment, {
      storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
      externalReference: reference,
    });

    return c.json(res);
  }
);

storeRoutes.get("/:storeId/users/:userId/orders", async (c) => {
  const { userId } = c.req.param();

  const orders = await c.env.runQuery(api.storeFront.onlineOrder.getAll, {
    storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
  });

  return c.json(orders);
});

storeRoutes.get("/:storeId/users/:userId/orders/:orderId", async (c) => {
  const { orderId } = c.req.param();

  const order = await c.env.runQuery(api.storeFront.onlineOrder.getById, {
    orderId: orderId as Id<"onlineOrder">,
  });

  return c.json(order);
});

export { storeRoutes };
