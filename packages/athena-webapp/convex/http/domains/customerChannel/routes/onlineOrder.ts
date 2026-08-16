import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";
import { updateOrderOwnerRouteOperationDefinition } from "../../../../operationAdmission/domains/u10_httpCustomer_definitions";
import {
  getOrderRouteReadDefinition,
  getOrdersRouteReadDefinition,
} from "../../../../operationAdmission/domains/u10_httpCustomer_readDefinitions";
import {
  parseIngressJson,
  requireAdmittedCustomerOwner,
} from "./admittedCustomer";

const onlineOrderRoutes: HonoWithConvex<ActionCtx> = new Hono();

onlineOrderRoutes.get(
  "/",
  admitHttpRead(getOrdersRouteReadDefinition, async (c, admitted) => {
    // No `storeFrontUserId` argument exists any more: the shopper whose orders
    // are listed is the admitted actor, full stop.
    const orders = await c.env.runQuery(
      internal.storeFront.onlineOrder.getAllForCustomerInternal,
      { owner: requireAdmittedCustomerOwner(admitted) },
    );

    return c.json(orders);
  }),
);

onlineOrderRoutes.get(
  "/:orderId",
  admitHttpRead(getOrderRouteReadDefinition, async (c, admitted) => {
    const { orderId } = c.req.param();
    const owner = requireAdmittedCustomerOwner(admitted);

    try {
      // The route's own `isAuthorizedResourceOwner` check now lives inside the
      // callee, which refuses a missing row and a foreign row with the same
      // answer so the denial cannot be used to probe for order ids.
      const order = await c.env.runQuery(
        internal.storeFront.onlineOrder.getForCustomerInternal,
        { identifier: orderId as Id<"onlineOrder">, owner },
      );

      if (!order) {
        return c.json({ error: "Order not found" }, 404);
      }

      return c.json(order);
    } catch {
      return c.json({ error: "Forbidden" }, 403);
    }
  }),
);

// Update the owner of the bag
onlineOrderRoutes.post(
  "/owner",
  admitHttpRoute(
    updateOrderOwnerRouteOperationDefinition,
    async (c, admitted) => {
      try {
        const { currentOwnerId } = parseIngressJson(admitted);

        // `newOwnerId` is gone from the call: the account the orders move TO is
        // the admitted shopper, never a body-supplied id.
        const b = await c.env.runMutation(
          internal.storeFront.onlineOrder.updateOwnerInternal,
          {
            currentOwner: currentOwnerId as Id<"guest">,
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

export { onlineOrderRoutes };
