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
  addBagItemRouteOperationDefinition,
  clearBagRouteOperationDefinition,
  deleteBagItemRouteOperationDefinition,
  updateBagItemRouteOperationDefinition,
  updateBagOwnerRouteOperationDefinition,
} from "../../../../operationAdmission/domains/u10_httpCustomer_definitions";
import { getBagRouteReadDefinition } from "../../../../operationAdmission/domains/u10_httpCustomer_readDefinitions";
import {
  admittedCustomerId,
  parseIngressJson,
  requireAdmittedCustomerOwner,
} from "./admittedCustomer";

const bagRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Get a specific bag
bagRoutes.get(
  "/:bagId",
  admitHttpRead(getBagRouteReadDefinition, async (c, admitted) => {
    const { bagId } = c.req.param();

    // The store and the shopper both come from the admitted claim now, so the
    // route no longer trusts the `store_id` / `user_id` cookies directly.
    const owner = requireAdmittedCustomerOwner(admitted);

    if (bagId == "active") {
      const storeFrontUserId = admittedCustomerId(owner);

      try {
        const bag = await c.env.runQuery(
          internal.storeFront.bag.getByUserIdInternal,
          { storeFrontUserId, owner },
        );

        if (!bag) {
          const b = await c.env.runMutation(internal.storeFront.bag.create, {
            storeFrontUserId,
            storeId: owner.storeId,
            owner,
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
  }),
);

// Add an item to a bag
bagRoutes.post(
  "/:bagId/items",
  admitHttpRoute(addBagItemRouteOperationDefinition, async (c, admitted) => {
    const { bagId } = c.req.param();
    const { productId, productSkuId, quantity, productSku } =
      parseIngressJson(admitted);

    const owner = requireAdmittedCustomerOwner(admitted);

    // `bagId` is still caller-supplied — it is the target, not the identity.
    // `addItemToBag` resolves it and refuses a bag that is not this shopper's.
    const b = await c.env.runMutation(
      internal.storeFront.bagItem.addItemToBag,
      {
        productId: productId as Id<"product">,
        quantity,
        storeFrontUserId: admittedCustomerId(owner),
        bagId: bagId as Id<"bag">,
        productSkuId: productSkuId as Id<"productSku">,
        productSku,
        owner,
      },
    );

    return c.json(b);
  }),
);

// Update the owner of a bag
bagRoutes.post(
  "/:bagId/owner",
  admitHttpRoute(updateBagOwnerRouteOperationDefinition, async (c, admitted) => {
    try {
      const { currentOwnerId, newOwnerId } = parseIngressJson(admitted);
      const owner = requireAdmittedCustomerOwner(admitted);

      const b = await c.env.runMutation(internal.storeFront.bag.updateOwner, {
        currentOwner: currentOwnerId as Id<"guest">,
        newOwner: newOwnerId as Id<"storeFrontUser">,
        owner,
      });
      return c.json(b);
    } catch (e) {
      console.error(e);
      return c.json({ error: "Internal server error" }, 400);
    }
  }),
);

// Delete an item from a bag
bagRoutes.delete(
  "/:bagId/items/:itemId",
  admitHttpRoute(deleteBagItemRouteOperationDefinition, async (c, admitted) => {
    const { itemId } = c.req.param();

    await c.env.runMutation(internal.storeFront.bagItem.deleteItemFromBag, {
      itemId: itemId as Id<"bagItem">,
      owner: requireAdmittedCustomerOwner(admitted),
    });

    return c.json({ success: true });
  }),
);

// Delete all item from a bag
bagRoutes.delete(
  "/:bagId/items/",
  admitHttpRoute(clearBagRouteOperationDefinition, async (c, admitted) => {
    const { bagId } = c.req.param();

    await c.env.runMutation(internal.storeFront.bag.clearBag, {
      id: bagId as Id<"bag">,
      owner: requireAdmittedCustomerOwner(admitted),
    });

    return c.json({ success: true });
  }),
);

// Update an item in a bag
bagRoutes.put(
  "/:bagId/items/:itemId",
  admitHttpRoute(updateBagItemRouteOperationDefinition, async (c, admitted) => {
    const { itemId } = c.req.param();
    const { quantity } = parseIngressJson(admitted);

    const b = await c.env.runMutation(
      internal.storeFront.bagItem.updateItemInBag,
      {
        quantity,
        itemId: itemId as Id<"bagItem">,
        owner: requireAdmittedCustomerOwner(admitted),
      },
    );
    return c.json(b);
  }),
);

export { bagRoutes };
