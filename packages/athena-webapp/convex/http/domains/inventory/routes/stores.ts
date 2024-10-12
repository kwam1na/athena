import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
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

// customers
storeRoutes.get("/:storeId/customers", async (c) => {
  return c.json({});
});

// Get a specific bag
storeRoutes.get("/:storeId/customers/:customerId/bags/:bagId", async (c) => {
  const { bagId, storeId } = c.req.param();

  if (bagId == "active") {
    const customerId = c.req.param("customerId");

    if (!customerId) {
      return c.json({ error: "Customer id missing" }, 404);
    }

    const bag = await c.env.runQuery(api.storeFront.bag.getByCustomerId, {
      customerId: customerId as Id<"customer"> | Id<"guest">,
    });

    if (!bag) {
      const b = await c.env.runMutation(api.storeFront.bag.create, {
        customerId: customerId as Id<"customer"> | Id<"guest">,
        storeId: storeId as Id<"store">,
      });

      return c.json(b);
    }
    return c.json(bag);
  }

  return c.json({});
});

// Create a new bag
storeRoutes.post("/:storeId/customers/:customerId/bags", async (c) => {
  const { customerId } = await c.req.json();
  return c.json({});
});

// Delete a bag
storeRoutes.delete("/:storeId/customers/:customerId/bags/:bagId", async (c) => {
  const { bagId } = c.req.param();
  return c.json({});
});

// Get all items in a bag
storeRoutes.get(
  "/:storeId/customers/:customerId/bags/:bagId/items",
  async (c) => {
    const { bagId } = c.req.param();
    return c.json({});
  }
);

storeRoutes.post(
  "/:storeId/customers/:customerId/bags/:bagId/items",
  async (c) => {
    const { bagId, customerId } = c.req.param();
    const { productId, productSkuId, quantity, productSku } =
      await c.req.json();

    // console.table({ productId, quantity, price });

    const b = await c.env.runMutation(api.storeFront.bagItem.addItemToBag, {
      productId: productId as Id<"product">,
      quantity,
      customerId: customerId as Id<"customer"> | Id<"guest">,
      bagId: bagId as Id<"bag">,
      productSkuId: productSkuId as Id<"productSku">,
      productSku,
    });

    return c.json(b);
  }
);

// Update an item in a bag
storeRoutes.put(
  "/:storeId/customers/:customerId/bags/:bagId/items/:itemId",
  async (c) => {
    const { bagId, itemId } = c.req.param();
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
  "/:storeId/customers/:customerId/bags/:bagId/items/:itemId",
  async (c) => {
    const { itemId } = c.req.param();

    await c.env.runMutation(api.storeFront.bagItem.deleteItemFromBag, {
      itemId: itemId as Id<"bagItem">,
    });

    return c.json({ success: true });
  }
);

export { storeRoutes };
