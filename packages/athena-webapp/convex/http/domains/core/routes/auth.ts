import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import {
  logoutStorefrontUserRouteOperationDefinition,
  verifyStorefrontAuthCodeRouteOperationDefinition,
} from "../../../../operationAdmission/domains/u11_httpCore_definitions";
import { admitHttpRoute } from "../../../../platform/operationAdmission";
import { getStoreDataFromRequest } from "../../../utils";
import { Id } from "../../../../_generated/dataModel";
import { getCookie, setCookie } from "hono/cookie";
import {
  admittedCustomerActorId,
  admittedCustomerOwner,
} from "./admittedOwner";

const authRoutes: HonoWithConvex<ActionCtx> = new Hono();

/**
 * Email verification for the storefront.
 *
 * The shopper arrives holding a guest (or returning user) claim — that is the
 * row the new account inherits its name from — so the id the code is verified
 * against comes from the admitted actor, and the store comes from the claim
 * ROW rather than the `store_id` cookie. A bearer id for a different shopper
 * can no longer mint a session: `verifyCodeInternal` refuses any `userId` that
 * is not the admitted one.
 */
authRoutes.post(
  "/verify",
  admitHttpRoute(
    verifyStorefrontAuthCodeRouteOperationDefinition,
    async (c, { admission, ingress }) => {
      const { organizationId } = getStoreDataFromRequest(c);

      const owner = admittedCustomerOwner(admission);
      const userId = admittedCustomerActorId(admission);

      const { email, firstName, lastName, code } = JSON.parse(
        ingress.rawBody || "{}",
      );

      if (!organizationId) {
        return c.json({ error: "Store or organization id missing" }, 404);
      }

      if (code) {
        try {
          const res = await c.env.runMutation(
            internal.storeFront.auth.verifyCodeInternal,
            {
              code,
              email,
              storeId: owner.storeId,
              organizationId: organizationId as Id<"organization">,
              userId,
              owner,
            },
          );

          if (res.user) {
            setCookie(c, "user_id", res.user._id, {
              path: "/",
              secure: true,
              domain: "wigclub.store",
              httpOnly: true,
              sameSite: "None",
              maxAge: 90 * 24 * 60 * 60, // 90 days in seconds
            });
          }

          return c.json(res);
        } catch (e) {
          return c.json({ error: (e as Error).message }, 400);
        }
      }

      if (email) {
        const res = await c.env.runAction(
          internal.storeFront.auth.sendVerificationCodeViaProviderInternal,
          {
            email,
            firstName,
            lastName,
            storeId: owner.storeId,
            owner,
          },
        );

        return c.json(res);
      }

      return c.json({});
    },
  ),
);

// Clearing the claim cookie needs no claim: a shopper whose cookie is already
// unusable must still be able to drop it, so this is anonymous ingress fenced
// by the storefront origin allowlist. It reads no claim and calls nothing.
authRoutes.post(
  "/logout",
  admitHttpRoute(logoutStorefrontUserRouteOperationDefinition, async (c) => {
    setCookie(c, "user_id", "", {
      path: "/",
      secure: true,
      domain: "wigclub.store",
      httpOnly: true,
      sameSite: "None",
      maxAge: 0, // Expires immediately
    });

    console.log("deleted cookie");

    const co = getCookie(c, "user_id");

    console.log("cookie: ", co);

    return c.json({ success: true });
  }),
);

export { authRoutes };
