import { Hono, type Context } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";
import { updateStorefrontUserRouteOperationDefinition } from "../../../../operationAdmission/domains/httpCustomer_definitions";
import { getStorefrontUserRouteReadDefinition } from "../../../../operationAdmission/domains/httpCustomer_readDefinitions";
import {
  isCustomerOwnershipDenial,
  parseIngressJson,
  requireAdmittedCustomerOwner,
} from "./admittedCustomer";

const userRoutes: HonoWithConvex<ActionCtx> = new Hono();

/**
 * `:userId` is a caller-supplied path parameter, so it is a TARGET and never an
 * identity. Both handlers forward the admitted `owner` alongside it and
 * `storeFront/user` refuses any id that is not the admitted shopper's — which
 * is what stops `GET /users/<someone else>` from reading a stranger's row.
 *
 * That refusal is a 403 on every one of the four call sites below. It used to
 * be a 400 carrying the internal message on the reads, and an uncaught throw —
 * rendered by Hono as a bare 500 — on the writes. Any OTHER error propagates:
 * a genuine fault must not be dressed up as a client error.
 */
function customerDenialResponse(c: Context, error: unknown) {
  if (isCustomerOwnershipDenial(error)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  throw error;
}

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
      } catch (error) {
        return customerDenialResponse(c, error);
      }
    }

    try {
      const user = await c.env.runQuery(internal.storeFront.user.getById, {
        id: userId as Id<"storeFrontUser">,
        owner,
      });

      return c.json(user);
    } catch (error) {
      return customerDenialResponse(c, error);
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

        try {
          const user = await c.env.runMutation(
            internal.storeFront.user.update,
            {
              id: owner.storeFrontUserId,
              email,
              firstName,
              lastName,
              shippingAddress,
              billingAddress,
              phoneNumber,
              owner,
            },
          );

          return c.json(user);
        } catch (error) {
          return customerDenialResponse(c, error);
        }
      }

      try {
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
      } catch (error) {
        return customerDenialResponse(c, error);
      }
    },
  ),
);

export { userRoutes };
