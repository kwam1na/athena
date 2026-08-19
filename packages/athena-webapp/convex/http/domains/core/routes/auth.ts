import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import {
  logoutStorefrontUserRouteOperationDefinition,
  verifyStorefrontAuthCodeRouteOperationDefinition,
} from "../../../../operationAdmission/domains/httpCore_definitions";
import { admitHttpRoute } from "../../../../platform/operationAdmission";
import {
  getStoreDataFromRequest,
  readVerifiedGuestIdFromRequest,
} from "../../../utils";
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
            // Mint the guest→account MERGE GRANT.
            //
            // This is the one moment the server sees a guest session and an
            // account it has just AUTHENTICATED. The five merge routes the
            // storefront fires next (bag, savedBag, orders, analytics,
            // rewards) then authorize on the grant written here, not on
            // anything the caller presents — which is what the previous
            // `claimGuestId` cookie comparison could never do, since both
            // sides of that comparison arrived on the same request.
            //
            // The guest id is the VERIFIED one, never the raw cookie. Round 3
            // minted the grant from `getCookie(c, "guest_id")`, so anyone who
            // knew a victim's guest id could present it while signing in to
            // their OWN account and receive a grant on the victim's row — the
            // merge then passed every check. A signed cookie is what closes
            // that: an id here carries an HMAC this server minted for this
            // browser's guest session, so knowing the id is no longer enough.
            //
            // There is deliberately NO legacy upgrade on this path. A
            // pre-signing cookie is upgraded ONLY at the two bootstrap mint
            // points; upgrading it here would restore exactly the primitive
            // above.
            //
            // Isolated try/catch: a grant that fails to mint must not turn an
            // authenticated sign-in into a 400 with a BURNED verification
            // code. The shopper is signed in either way; only the merge goes
            // unauthorized, and they can re-run it by signing in again.
            const guestId = readVerifiedGuestIdFromRequest(c);
            if (guestId) {
              try {
                await c.env.runMutation(
                  internal.storeFront.guest.grantMergeToStoreFrontUser,
                  {
                    guestId,
                    owner: {
                      storeFrontUserId: res.user._id,
                      storeId: owner.storeId,
                    },
                  },
                );
              } catch (grantError) {
                console.error(
                  "Failed to mint guest merge grant; sign-in still succeeded",
                  grantError,
                );
              }
            }

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
