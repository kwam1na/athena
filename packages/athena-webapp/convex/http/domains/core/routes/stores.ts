import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { redeemPromoCodeRouteOperationDefinition } from "../../../../operationAdmission/domains/u11_httpCore_definitions";
import {
  getStoreRouteReadDefinition,
  listPromoCodeItemsRouteReadDefinition,
  listPromoCodesRouteReadDefinition,
  listRedeemedPromoCodesRouteReadDefinition,
} from "../../../../operationAdmission/domains/u11_httpCore_readDefinitions";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";
import { getStoreDataFromRequest } from "../../../utils";
import { admittedCustomerActorId } from "./admittedOwner";

const storeRoutes: HonoWithConvex<ActionCtx> = new Hono();

storeRoutes.get(
  "/promoCodes",
  admitHttpRead(listPromoCodesRouteReadDefinition, async (c) => {
    const { storeId } = getStoreDataFromRequest(c);

    if (!storeId) {
      return c.json({ error: "Store id missing" }, 404);
    }

    try {
      const res = await c.env.runQuery(
        internal.inventory.promoCode.getAllInternal,
        {
          storeId: storeId,
        },
      );

      return c.json(res);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  }),
);

storeRoutes.get(
  "/promoCodeItems",
  admitHttpRead(listPromoCodeItemsRouteReadDefinition, async (c) => {
    const { storeId } = getStoreDataFromRequest(c);

    if (!storeId) {
      return c.json({ error: "Store id missing" }, 404);
    }

    try {
      const res = await c.env.runQuery(
        internal.inventory.promoCode.getAllItems,
        {
          storeId: storeId,
        },
      );

      return c.json(res);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  }),
);

/**
 * A shopper's own redemptions. The id read by comes from the admitted claim,
 * not from the `user_id` cookie the handler used to forward verbatim — so
 * setting someone else's id in a cookie no longer lists their redemptions.
 */
storeRoutes.get(
  "/redeemedPromoCodes",
  admitHttpRead(
    listRedeemedPromoCodesRouteReadDefinition,
    async (c, { admission }) => {
      try {
        const res = await c.env.runQuery(
          internal.inventory.promoCode.getRedeemedPromoCodesForUser,
          {
            storeFrontUserId: admittedCustomerActorId(admission),
          },
        );

        return c.json(res);
      } catch (e) {
        return c.json({ error: (e as Error).message }, 400);
      }
    },
  ),
);

storeRoutes.post(
  "/promoCodes",
  admitHttpRoute(
    redeemPromoCodeRouteOperationDefinition,
    async (c, { admission, ingress }) => {
      try {
        // The rail already read the body once; parsing the same string it
        // handed us is what keeps the bytes a verifier covers and the bytes the
        // handler acts on identical.
        const { code, checkoutSessionId } = JSON.parse(ingress.rawBody || "{}");

        const res = await c.env.runMutation(internal.inventory.promoCode.redeem, {
          code,
          storeFrontUserId: admittedCustomerActorId(admission),
          checkoutSessionId: checkoutSessionId as Id<"checkoutSession">,
        });

        return c.json(res);
      } catch (e) {
        return c.json({ error: (e as Error).message }, 400);
      }
    },
  ),
);

storeRoutes.get(
  "/:storeId",
  admitHttpRead(getStoreRouteReadDefinition, async (c) => {
    const { storeId } = c.req.param();
    const organizationId = c.req.param("organizationId");

    if (!organizationId) {
      return c.json({ error: "Organization id missing" }, 404);
    }

    const store = await c.env.runQuery(internal.inventory.stores.getByIdOrSlug, {
      identifier: storeId,
      organizationId: organizationId as Id<"organization">,
    });

    if (!store) {
      return c.json({ error: "Store with identifier not found" }, 400);
    }

    return c.json(store);
  }),
);

export { storeRoutes };
