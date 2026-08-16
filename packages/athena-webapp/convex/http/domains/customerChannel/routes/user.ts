import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";
import { updateStorefrontUserRouteOperationDefinition } from "../../../../operationAdmission/domains/u10_httpCustomer_definitions";
import { getStorefrontUserRouteReadDefinition } from "../../../../operationAdmission/domains/u10_httpCustomer_readDefinitions";
import {
  parseIngressJson,
  requireAdmittedCustomerOwner,
} from "./admittedCustomer";

const userRoutes: HonoWithConvex<ActionCtx> = new Hono();

/**
 * `:userId` is a caller-supplied path parameter, so it is a TARGET and never an
 * identity. Both handlers forward the admitted `owner` alongside it and
 * `storeFront/user` refuses any id that is not the admitted shopper's — which
 * is what stops `GET /users/<someone else>` from reading a stranger's row.
 */

userRoutes.get(
  "/:userId",
  admitHttpRead(getStorefrontUserRouteReadDefinition, async (c, admitted) => {
    const { userId } = c.req.param();
    const owner = requireAdmittedCustomerOwner(admitted);

    if (userId == "me") {
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
    }

    try {
      const user = await c.env.runQuery(internal.storeFront.user.getById, {
        id: userId as Id<"storeFrontUser">,
        owner,
      });

      return c.json(user);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  }),
);

userRoutes.put(
  "/:userId",
  admitHttpRoute(
    updateStorefrontUserRouteOperationDefinition,
    async (c, admitted) => {
      const { userId } = c.req.param();
      const owner = requireAdmittedCustomerOwner(admitted);

      const {
        email,
        firstName,
        lastName,
        phoneNumber,
        shippingAddress,
        billingAddress,
      } = parseIngressJson(admitted);

      if (userId == "me") {
        if (!owner.storeFrontUserId) {
          return c.json(null, 200);
        }

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
      }

      const user = await c.env.runMutation(internal.storeFront.user.update, {
        id: userId as Id<"storeFrontUser">,
        email,
        firstName,
        lastName,
        shippingAddress,
        billingAddress,
        phoneNumber,
        owner,
      });

      return c.json(user);
    },
  ),
);

export { userRoutes };
