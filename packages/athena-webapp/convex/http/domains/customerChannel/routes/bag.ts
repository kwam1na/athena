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
  isCustomerOwnershipDenial,
  parseIngressJson,
  tryParseIngressJson,
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
      } catch (error) {
        // An ownership refusal is a 403; a genuine fault must stay a fault.
        // Collapsing both into a 400 "Internal server error" hid outages
        // behind a client-error status.
        if (isCustomerOwnershipDenial(error)) {
          return c.json({ error: "Forbidden" }, 403);
        }
        throw error;
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
    // `newOwnerId` is no longer read from the body: the account the bag moves
    // TO is the admitted shopper. `currentOwnerId` stays caller-supplied and
    // this route forwards NO evidence about it — the callee authorizes the
    // merge from the server-issued grant on the guest row, written at sign-in.
    const body = tryParseIngressJson(admitted);
    if (!body) {
      return c.json({ error: "Invalid request body" }, 400);
    }
    const { currentOwnerId } = body;
    const owner = requireAdmittedCustomerOwner(admitted);

    try {
      const b = await c.env.runMutation(internal.storeFront.bag.updateOwner, {
        currentOwner: currentOwnerId as Id<"guest">,
        owner,
      });
      return c.json(b);
    } catch (error) {
      // Only an ownership refusal is a 403. Everything else propagates: the
      // previous blanket `catch` reported every fault as a 400 "Internal
      // server error", which told the caller to stop retrying and told
      // monitoring nothing was wrong.
      if (isCustomerOwnershipDenial(error)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      throw error;
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
