import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import {
  createAnalyticsEventRouteOperationDefinition,
  updateAnalyticsOwnerRouteOperationDefinition,
} from "../../../../operationAdmission/domains/u11_httpCore_definitions";
import { getProductViewCountRouteReadDefinition } from "../../../../operationAdmission/domains/u11_httpCore_readDefinitions";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";
import {
  admittedClaimGuestId,
  admittedCustomerOwner,
} from "./admittedOwner";

const analyticsRoutes: HonoWithConvex<ActionCtx> = new Hono();

/**
 * The storefront event beacon.
 *
 * The store and the shopper the event is attributed to now come from the
 * admitted claim and travel as `owner`; they used to come from the `store_id`
 * and `user_id` cookies, which meant any caller could write events into
 * another store or under another shopper's id.
 */
analyticsRoutes.post(
  "/",
  admitHttpRoute(
    createAnalyticsEventRouteOperationDefinition,
    async (c, { admission, ingress }) => {
      const userAgent = c.req.header("user-agent") || "";
      const isMobile = /mobile|android|iphone|ipad|ipod/i.test(userAgent);

      const { action, origin, data, productId } = JSON.parse(
        ingress.rawBody || "{}",
      );

      const res = await c.env.runMutation(
        internal.storeFront.analytics.createInternal,
        {
          origin,
          action,
          data,
          device: isMobile ? "mobile" : "desktop",
          productId,
          owner: admittedCustomerOwner(admission),
        },
      );

      return c.json(res);
    },
  ),
);

// Endpoint for updating analytics owner from guest to registered user. The
// user the records move TO is the admitted shopper; only the guest id being
// re-owned stays caller-supplied, and the callee checks it against the
// admitted store.
analyticsRoutes.post(
  "/update-owner",
  admitHttpRoute(
    updateAnalyticsOwnerRouteOperationDefinition,
    async (c, admitted) => {
      const { admission, ingress } = admitted;
      try {
        const { guestId } = JSON.parse(ingress.rawBody || "{}");

        if (!guestId) {
          return c.json({ error: "Guest ID and User ID are required" }, 400);
        }

        await c.env.runMutation(
          internal.storeFront.analytics.updateOwnerInternal,
          {
            guestId: guestId as Id<"guest">,
            // Possession, not identity: the callee refuses a guest id the
            // caller holds no cookie for.
            claimGuestId: admittedClaimGuestId(admitted),
            owner: admittedCustomerOwner(admission),
          },
        );

        return c.json({ success: true });
      } catch (error) {
        console.error("Error updating analytics owner:", error);
        return c.json(
          { error: "Failed to update analytics owner", details: String(error) },
          500,
        );
      }
    },
  ),
);

// New: GET /product-view-count?productId=...
analyticsRoutes.get(
  "/product-view-count",
  admitHttpRead(getProductViewCountRouteReadDefinition, async (c) => {
    const productId = c.req.query("productId");
    if (!productId) {
      return c.json({ error: "Missing productId" }, 400);
    }
    const count = await c.env.runQuery(
      internal.storeFront.analytics.getProductViewCountInternal,
      {
        productId: productId as Id<"product">,
        currentDayStartMs: new Date(new Date().setHours(0, 0, 0, 0)).getTime(),
      },
    );

    return c.json(count);
  }),
);

export { analyticsRoutes };
