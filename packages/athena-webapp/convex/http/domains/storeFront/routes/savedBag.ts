import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { getCookie } from "hono/cookie";
import { Id } from "../../../../_generated/dataModel";
import {
  getStoreDataFromRequest,
  getStorefrontUserFromRequest,
} from "../../../utils";

const savedBagRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Get a specific bag
savedBagRoutes.get("/:bagId", async (c) => {
  const { bagId } = c.req.param();

  const { storeId } = getStoreDataFromRequest(c);

  if (!storeId) {
    return c.json({ error: "Store id missing" }, 404);
  }

  if (bagId == "active") {
    const userId = getStorefrontUserFromRequest(c);

    if (!userId) {
      return c.json({ error: "Customer id missing" }, 404);
    }

    try {
      const bag = await c.env.runQuery(api.storeFront.savedBag.getByUserId, {
        storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
      });

      if (!bag) {
        const b = await c.env.runMutation(api.storeFront.savedBag.create, {
          storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
          storeId: storeId as Id<"store">,
        });

        return c.json(b);
      }
      return c.json(bag);
    } catch (e) {
      console.error(e);
      return c.json({ error: "Internal server error" }, 400);
    }
  }

  return c.json({});
});

// Add an item to a bag
savedBagRoutes.post("/:bagId/items", async (c) => {
  const { bagId } = c.req.param();
  const { productId, productSkuId, quantity, productSku } = await c.req.json();

  const userId = getStorefrontUserFromRequest(c);

  const b = await c.env.runMutation(api.storeFront.savedBagItem.addItemToBag, {
    productId: productId as Id<"product">,
    quantity,
    storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
    savedBagId: bagId as Id<"savedBag">,
    productSkuId: productSkuId as Id<"productSku">,
    productSku,
  });

  return c.json(b);
});

// Update the owner of a bag
savedBagRoutes.post("/:bagId/owner", async (c) => {
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
});

// Delete an item from a bag
savedBagRoutes.delete("/:bagId/items/:itemId", async (c) => {
  const { itemId } = c.req.param();

  await c.env.runMutation(api.storeFront.savedBagItem.deleteItemFromSavedBag, {
    itemId: itemId as Id<"savedBagItem">,
  });

  return c.json({ success: true });
});

// Update an item in a bag
savedBagRoutes.put("/:bagId/items/:itemId", async (c) => {
  const { itemId } = c.req.param();
  const { quantity } = await c.req.json();

  const b = await c.env.runMutation(
    api.storeFront.savedBagItem.updateItemInBag,
    {
      quantity,
      itemId: itemId as Id<"savedBagItem">,
    }
  );
  return c.json(b);
});

export { savedBagRoutes };
