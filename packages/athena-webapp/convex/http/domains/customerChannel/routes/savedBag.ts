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
  isCustomerOwnershipDenial,
  parseIngressJson,
  tryParseIngressJson,
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
      } catch (error) {
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
      // As on `POST /bags/:bagId/owner`: the destination account is the
      // admitted shopper, and the guest side is authorized by the server-issued
      // merge grant on the guest row — nothing this route forwards.
      const body = tryParseIngressJson(admitted);
      if (!body) {
        return c.json({ error: "Invalid request body" }, 400);
      }
      const { currentOwnerId } = body;

      try {
        const b = await c.env.runMutation(
          internal.storeFront.savedBag.updateOwner,
          {
            currentOwner: currentOwnerId as Id<"guest">,
            owner: requireAdmittedCustomerOwner(admitted),
          },
        );
        return c.json(b);
      } catch (error) {
        if (isCustomerOwnershipDenial(error)) {
          return c.json({ error: "Forbidden" }, 403);
        }
        // `currentOwnerId` is still caller-supplied. A non-id string reaches
        // the callee's `v.id("guest")` argument validator and raises rather
        // than denying — that is a malformed request, not a server fault.
        // (Production Convex names this `ArgumentValidationError`; the
        // in-process test harness in `convex-test` raises a plain `Error`
        // prefixed `Validator error:` for the same condition.)
        if (
          error instanceof Error &&
          (error.message.includes("ArgumentValidationError") ||
            error.message.includes("Validator error"))
        ) {
          return c.json({ error: "Invalid guest id" }, 400);
        }
        throw error;
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
