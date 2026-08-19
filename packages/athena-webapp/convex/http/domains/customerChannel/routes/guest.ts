import { Hono, type Context } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getCookie } from "hono/cookie";
import {
  getStoreDataFromRequest,
  isRecoverableGuestMarker,
  readLegacyUnsignedGuestCookieForBootstrap,
  readVerifiedGuestIdFromRequest,
  setSignedGuestCookie,
} from "../../../utils";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";
import {
  createGuestRouteOperationDefinition,
  updateGuestRouteOperationDefinition,
} from "../../../../operationAdmission/domains/httpCustomer_definitions";
import { getGuestRouteReadDefinition } from "../../../../operationAdmission/domains/httpCustomer_readDefinitions";
import {
  parseIngressJson,
  requireAdmittedCustomerOwner,
} from "./admittedCustomer";
import { SERVER_INITIATED_OWNER } from "../../../../storeFront/customerOwnership";

const guestRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Get all bags
guestRoutes.get(
  "/",
  admitHttpRead(getGuestRouteReadDefinition, async (c) => {
    // Deliberately public rather than claim-only: this is the route that
    // RECOVERS a stale or unknown guest cookie, so admitting it as a claim
    // would turn "unknown guest id" into a terminal denial and break the
    // bootstrap it exists for.
    //
    // RESIDUAL RISK (known and accepted — see the U10 scope decision): the
    // guest id comes from a cookie, and a cookie is caller-supplied. Any
    // caller can therefore present an arbitrary `guest_id` and read back that
    // guest row, including one belonging to another shopper. There is no
    // admitted owner on this path to check it against, so the read below
    // passes SERVER_INITIATED_OWNER: the missing check is deliberate and
    // greppable rather than an omitted argument. This is an accepted IDOR on
    // the guest record, the price of keeping bootstrap recovery public.
    //
    // BOOTSTRAP MINT POINT #2 (of two). Guest cookies are SIGNED here and at
    // `GET /storefront`; every cookie this route issues carries an HMAC, and
    // this is one of only two places allowed to upgrade a legacy unsigned one.
    // (`GET /homepage-snapshot` mints nothing.)
    const presentedCookie = getCookie(c, "guest_id");

    const marker = c.req.query("marker");

    const { storeId, organizationId } = getStoreDataFromRequest(c);

    if (!presentedCookie) {
      return c.json({ error: "Guest id missing" }, 404);
    }

    // A cookie whose signature verifies is a session this server issued to
    // THIS browser: read it back as before.
    const verifiedGuestId = readVerifiedGuestIdFromRequest(c);
    if (verifiedGuestId) {
      const guest = await c.env.runQuery(internal.storeFront.guest.getById, {
        id: verifiedGuestId,
        owner: SERVER_INITIATED_OWNER,
      });

      if (guest) return c.json(guest);
    }

    // ONE-TIME LEGACY UPGRADE, confined to bootstrap. A pre-signing cookie that
    // still names a real guest row IN THIS STORE is re-minted SIGNED, so an
    // existing shopper's cart survives the deploy. A cookie carrying a
    // signature that does NOT verify is tampering, never a legacy value:
    // `readLegacyUnsignedGuestCookieForBootstrap` refuses it, and that caller
    // falls through to recovery and gets a NEW session rather than the row
    // they named.
    //
    // RESIDUAL, and the reason this path should be DELETED once legacy cookies
    // have aged out (90 days, the cookie's own max-age): while it exists, a
    // caller who knows another shopper's guest id can present it here
    // unsigned and be handed a signed cookie for it — the round-3 attack plus
    // one request. That is strictly narrower than the status quo it replaces
    // (where every caller could do it on every request, forever) and it is the
    // price of not dropping every existing cart on deploy, but it is a window,
    // not a closed door.
    const legacyGuestId = readLegacyUnsignedGuestCookieForBootstrap(c);
    if (legacyGuestId && storeId) {
      const upgraded = await c.env.runQuery(
        internal.storeFront.guest.resolveLegacyGuestForCookieUpgrade,
        { guestId: legacyGuestId, storeId: storeId as Id<"store"> },
      );

      if (upgraded) {
        if (!setSignedGuestCookie(c, upgraded)) {
          return guestSessionsUnavailable(c);
        }

        const guest = await c.env.runQuery(internal.storeFront.guest.getById, {
          id: upgraded,
          owner: SERVER_INITIATED_OWNER,
        });

        return c.json(guest);
      }
    }

    // Recovery: the presented cookie is unusable — unknown, malformed or
    // tampered — so this shopper needs a session.
    //
    // `guest.create` requires a store since U6 — a guest that cannot be
    // clamped to one can never be admitted, so refuse to mint it — and the
    // marker lookup is scoped to that same store.
    if (!storeId) {
      return c.json({ error: "Store id missing" }, 404);
    }

    // The marker is a session-recovery SECRET (see `isRecoverableGuestMarker`
    // in `http/utils.ts`): only a high-entropy marker is looked up, and only
    // within this store. Absent, empty or short means NO marker — mint a fresh
    // guest rather than resolve to somebody else's row. This is the recovery
    // path a caller with a garbage cookie lands on, so "no marker" resolving
    // to the oldest marker-less guest would hand any caller a signed session
    // for a stranger.
    const recoverableMarker = isRecoverableGuestMarker(marker)
      ? marker
      : undefined;
    const guest =
      (recoverableMarker
        ? await c.env.runQuery(internal.storeFront.guest.getByMarker, {
            marker: recoverableMarker,
            storeId: storeId as Id<"store">,
          })
        : null) ??
      (await c.env.runMutation(internal.storeFront.guest.create, {
        marker: recoverableMarker,
        creationOrigin: "storefront",
        storeId: storeId as Id<"store">,
        organizationId,
      }));

    if (guest && !setSignedGuestCookie(c, guest._id)) {
      return guestSessionsUnavailable(c);
    }

    return c.json(guest);
  }),
);

/**
 * FAIL CLOSED when `ATHENA_STOREFRONT_COOKIE_SECRET` is unset.
 *
 * With no secret nothing can issue a guest cookie that any consumer would
 * accept, so this route says so rather than hand back a session that would
 * silently fail every subsequent write. Anonymous catalog browse does not come
 * through here and is unaffected: `GET /storefront` still returns the store,
 * just without a guest identity.
 */
function guestSessionsUnavailable(c: Context) {
  console.error(
    "Guest sessions are unavailable: ATHENA_STOREFRONT_COOKIE_SECRET is not configured",
  );
  return c.json({ error: "Guest sessions are unavailable" }, 503);
}

guestRoutes.put(
  "/",
  admitHttpRoute(updateGuestRouteOperationDefinition, async (c, admitted) => {
    const owner = requireAdmittedCustomerOwner(admitted);

    // The guest updated is the admitted guest, never a body-supplied id.
    if (!owner.guestId) {
      return c.json({ error: "Guest id missing" }, 404);
    }

    const { email, firstName, lastName, phoneNumber } =
      parseIngressJson(admitted);

    const guest = await c.env.runMutation(internal.storeFront.guest.update, {
      id: owner.guestId,
      email,
      firstName,
      lastName,
      phoneNumber,
      owner,
    });

    return c.json(guest);
  }),
);

// Create a new guest
guestRoutes.post(
  "/",
  admitHttpRoute(createGuestRouteOperationDefinition, async (c) => {
    // Pre-claim ingress: there is no admitted shopper yet, this request is what
    // mints one. The store still has to be known at creation — U6 made
    // `guest.create` require it so an unclampable guest can never exist.
    const { storeId, organizationId } = getStoreDataFromRequest(c);

    if (!storeId) {
      return c.json({ error: "Store id missing" }, 404);
    }

    const guest = await c.env.runMutation(internal.storeFront.guest.create, {
      storeId: storeId as Id<"store">,
      organizationId,
    });

    return c.json({ id: guest });
  }),
);

export { guestRoutes };
