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
  addSavedBagItemRouteOperationDefinition,
  deleteSavedBagItemRouteOperationDefinition,
  updateSavedBagItemRouteOperationDefinition,
  updateSavedBagOwnerRouteOperationDefinition,
} from "../../../../operationAdmission/domains/u10_httpCustomer_definitions";
import { getSavedBagRouteReadDefinition } from "../../../../operationAdmission/domains/u10_httpCustomer_readDefinitions";
import {
  admittedCustomerId,
  parseIngressJson,
  requireAdmittedCustomerOwner,
} from "./admittedCustomer";

const savedBagRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Get a specific bag
savedBagRoutes.get(
  "/:bagId",
  admitHttpRead(getSavedBagRouteReadDefinition, async (c, admitted) => {
    const { bagId } = c.req.param();

    const owner = requireAdmittedCustomerOwner(admitted);

    if (bagId == "active") {
      const storeFrontUserId = admittedCustomerId(owner);

      try {
        const bag = await c.env.runQuery(
          internal.storeFront.savedBag.getByUserId,
          { storeFrontUserId, owner },
        );

        if (!bag) {
          const b = await c.env.runMutation(
            internal.storeFront.savedBag.create,
            { storeFrontUserId, storeId: owner.storeId, owner },
          );

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
savedBagRoutes.post(
  "/:bagId/items",
  admitHttpRoute(
    addSavedBagItemRouteOperationDefinition,
    async (c, admitted) => {
      const { bagId } = c.req.param();
      const { productId, productSkuId, quantity, productSku } =
        parseIngressJson(admitted);

      const owner = requireAdmittedCustomerOwner(admitted);

      const b = await c.env.runMutation(
        internal.storeFront.savedBagItem.addItemToBag,
        {
          productId: productId as Id<"product">,
          quantity,
          storeFrontUserId: admittedCustomerId(owner),
          savedBagId: bagId as Id<"savedBag">,
          productSkuId: productSkuId as Id<"productSku">,
          productSku,
          owner,
        },
      );

      return c.json(b);
    },
  ),
);

// Update the owner of a bag
savedBagRoutes.post(
  "/:bagId/owner",
  admitHttpRoute(
    updateSavedBagOwnerRouteOperationDefinition,
    async (c, admitted) => {
      try {
        const { currentOwnerId, newOwnerId } = parseIngressJson(admitted);

        const b = await c.env.runMutation(
          internal.storeFront.savedBag.updateOwner,
          {
            currentOwner: currentOwnerId as Id<"guest">,
            newOwner: newOwnerId as Id<"storeFrontUser">,
            owner: requireAdmittedCustomerOwner(admitted),
          },
        );
        return c.json(b);
      } catch (e) {
        console.error(e);
        return c.json({ error: "Internal server error" }, 400);
      }
    },
  ),
);

// Delete an item from a bag
savedBagRoutes.delete(
  "/:bagId/items/:itemId",
  admitHttpRoute(
    deleteSavedBagItemRouteOperationDefinition,
    async (c, admitted) => {
      const { itemId } = c.req.param();

      await c.env.runMutation(
        internal.storeFront.savedBagItem.deleteItemFromSavedBag,
        {
          itemId: itemId as Id<"savedBagItem">,
          owner: requireAdmittedCustomerOwner(admitted),
        },
      );

      return c.json({ success: true });
    },
  ),
);

// Update an item in a bag
savedBagRoutes.put(
  "/:bagId/items/:itemId",
  admitHttpRoute(
    updateSavedBagItemRouteOperationDefinition,
    async (c, admitted) => {
      const { itemId } = c.req.param();
      const { quantity } = parseIngressJson(admitted);

      const b = await c.env.runMutation(
        internal.storeFront.savedBagItem.updateItemInBag,
        {
          quantity,
          itemId: itemId as Id<"savedBagItem">,
          owner: requireAdmittedCustomerOwner(admitted),
        },
      );
      return c.json(b);
    },
  ),
);

export { savedBagRoutes };
