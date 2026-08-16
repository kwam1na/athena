import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";
import { updateMeRouteOperationDefinition } from "../../../../operationAdmission/domains/u10_httpCustomer_definitions";
import { getMeRouteReadDefinition } from "../../../../operationAdmission/domains/u10_httpCustomer_readDefinitions";
import {
  parseIngressJson,
  requireAdmittedCustomerOwner,
} from "./admittedCustomer";

const meRoutes: HonoWithConvex<ActionCtx> = new Hono();

meRoutes.get(
  "/",
  admitHttpRead(getMeRouteReadDefinition, async (c, admitted) => {
    const owner = requireAdmittedCustomerOwner(admitted);

    // A guest is admitted but has no account row, which is the same "no signed
    // in shopper" answer the cookieless request used to get.
    if (!owner.storeFrontUserId) {
      return c.json(null, 200);
    }

    try {
      const user = await c.env.runQuery(internal.storeFront.user.getById, {
        id: owner.storeFrontUserId,
        owner,
      });

      return c.json(user);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  }),
);

meRoutes.put(
  "/",
  admitHttpRoute(updateMeRouteOperationDefinition, async (c, admitted) => {
    const owner = requireAdmittedCustomerOwner(admitted);

    if (!owner.storeFrontUserId) {
      return c.json({ error: "User id missing" }, 404);
    }

    const {
      email,
      firstName,
      lastName,
      phoneNumber,
      shippingAddress,
      billingAddress,
    } = parseIngressJson(admitted);

    const user = await c.env.runMutation(internal.storeFront.user.update, {
      id: owner.storeFrontUserId,
      email,
      firstName,
      lastName,
      shippingAddress,
      billingAddress,
      phoneNumber,
      owner,
    });

    return c.json(user);
  }),
);

export { meRoutes };
