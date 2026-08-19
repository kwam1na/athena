import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import {
  createAnalyticsEventRouteOperationDefinition,
  updateAnalyticsOwnerRouteOperationDefinition,
} from "../../../../operationAdmission/domains/httpCore_definitions";
import { getProductViewCountRouteReadDefinition } from "../../../../operationAdmission/domains/httpCore_readDefinitions";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";
import { admittedCustomerOwner } from "./admittedOwner";
import { guestMergeErrorResponse } from "../../customerChannel/routes/admittedCustomer";

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
// user the records move TO is the admitted shopper; the guest id being
// re-owned stays caller-supplied, and the callee authorizes it against the
// server-issued merge grant on the guest row plus the admitted store.
analyticsRoutes.post(
  "/update-owner",
  admitHttpRoute(
    updateAnalyticsOwnerRouteOperationDefinition,
    async (c, admitted) => {
      const { admission, ingress } = admitted;

      // A malformed body is a client error, answered here rather than left to
      // escape as a `SyntaxError` that Convex renders as a server fault. Typed
      // as `Record<string, unknown>` rather than `any` so a rename or shape
      // change to `guestId` below is a compile error, not a silent pass.
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(ingress.rawBody || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return c.json({ error: "Invalid request body" }, 400);
        }
        body = parsed as Record<string, unknown>;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return c.json({ error: "Invalid request body" }, 400);
      }

      if (typeof body.guestId !== "string" || !body.guestId) {
        return c.json({ error: "Guest ID and User ID are required" }, 400);
      }

      try {
        await c.env.runMutation(
          internal.storeFront.analytics.updateOwnerInternal,
          {
            guestId: body.guestId as Id<"guest">,
            owner: admittedCustomerOwner(admission),
          },
        );

        return c.json({ success: true });
      } catch (error) {
        // Ownership refusal → 403, malformed guest id → 400, anything else is
        // a real fault and propagates. Same classification as the other four
        // merge routes, in the one place it lives: `guestMergeErrorResponse`.
        const denial = guestMergeErrorResponse(error);
        if (denial) return c.json(denial.body, denial.status);
        throw error;
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
