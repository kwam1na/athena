import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";
import { updateOrderOwnerRouteOperationDefinition } from "../../../../operationAdmission/domains/httpCustomer_definitions";
import {
  getOrderRouteReadDefinition,
  getOrdersRouteReadDefinition,
} from "../../../../operationAdmission/domains/httpCustomer_readDefinitions";
import {
  guestMergeErrorResponse,
  isCustomerOwnershipDenial,
  tryParseIngressJson,
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
      // callee. It returns null for an order that does not exist (404 below)
      // and refuses one that exists but is not this shopper's (403), which is
      // the pre-migration contract.
      const order = await c.env.runQuery(
        internal.storeFront.onlineOrder.getForCustomerInternal,
        { identifier: orderId as Id<"onlineOrder">, owner },
      );

      if (!order) {
        return c.json({ error: "Order not found" }, 404);
      }

      return c.json(order);
    } catch (error) {
      // Only an ownership refusal becomes 403. Anything else is a fault and
      // must surface as one: a bare `catch {}` here reported every bug in the
      // callee as "Forbidden", which hid outages behind an expected status and
      // made the 404 above unreachable whenever the callee threw.
      if (isCustomerOwnershipDenial(error)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      throw error;
    }
  }),
);

// Update the owner of the bag
onlineOrderRoutes.post(
  "/owner",
  admitHttpRoute(
    updateOrderOwnerRouteOperationDefinition,
    async (c, admitted) => {
      // A malformed body is a client error, answered here rather than left to
      // escape as a `SyntaxError` that Convex renders as a server fault. Same
      // shape as the sibling merge routes (`bag`, `savedBag`).
      const body = tryParseIngressJson(admitted);
      if (!body) {
        return c.json({ error: "Invalid request body" }, 400);
      }
      const { currentOwnerId } = body;

      try {
        // `newOwnerId` is gone from the call: the account the orders move TO is
        // the admitted shopper, never a body-supplied id.
        const b = await c.env.runMutation(
          internal.storeFront.onlineOrder.updateOwnerInternal,
          {
            currentOwner: currentOwnerId as Id<"guest">,
            // No merge evidence travels from the caller. The callee authorizes
            // on the server-issued grant written onto the guest row at sign-in.
            owner: requireAdmittedCustomerOwner(admitted),
          },
        );
        return c.json(b);
      } catch (error) {
        // Ownership refusal → 403, malformed guest id → 400, anything else is
        // a real fault and propagates. See `guestMergeErrorResponse`.
        const denial = guestMergeErrorResponse(error);
        if (denial) return c.json(denial.body, denial.status);
        throw error;
      }
    },
  ),
);

export { onlineOrderRoutes };
