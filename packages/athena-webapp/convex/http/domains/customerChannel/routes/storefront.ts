import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getCookie, setCookie } from "hono/cookie";
import {
  isRecoverableGuestMarker,
  readLegacyUnsignedGuestCookieForBootstrap,
  readVerifiedGuestIdFromRequest,
  setSignedGuestCookie,
} from "../../../utils";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";
import { storefrontInventoryBatchRouteOperationDefinition } from "../../../../operationAdmission/domains/u10_httpCustomer_definitions";
import { getStorefrontRouteReadDefinition } from "../../../../operationAdmission/domains/u10_httpCustomer_readDefinitions";
import { parseIngressJson } from "./admittedCustomer";

const storefrontRoutes: HonoWithConvex<ActionCtx> = new Hono();

storefrontRoutes.get(
  "/",
  admitHttpRead(getStorefrontRouteReadDefinition, async (c) => {
    // Store bootstrap for an anonymous visitor: public by construction, since
    // this is the request that hands out the store and guest cookies.
    const storeName = c.req.query("storeName");
    const marker = c.req.query("marker");
    const asNewUser = c.req.query("asNewUser");

    if (!storeName) {
      return c.json({ error: "Store name missing" }, 404);
    }

    const store = await c.env.runQuery(internal.inventory.stores.findByName, {
      name: storeName,
    });

    // BOOTSTRAP MINT POINT #1 (of two). Guest cookies are SIGNED here and at
    // `GET /guests`; nowhere else issues one, and nowhere else upgrades one.
    // (`GET /homepage-snapshot` deliberately mints nothing: it is a public
    // browse read that sets only the store cookies.)
    const accountId = getCookie(c, "user_id");
    let guestId = readVerifiedGuestIdFromRequest(c);

    // ONE-TIME LEGACY UPGRADE. A shopper whose cookie predates signing still
    // holds a bare guest id; re-minting it signed here is what keeps their
    // cart alive across this deploy. It is confined to bootstrap on purpose —
    // an upgrade at `/auth/verify` or at a merge would let any caller launder
    // an arbitrary guest id into a signed one, which is the hole being closed.
    //
    // The value is only accepted after the SERVER re-resolves it to a real
    // guest row in THIS store, so the upgrade cannot mint a session on a
    // string the shopper made up. It can still re-sign another shopper's guest
    // id if the caller knows one — the same accepted bootstrap IDOR that
    // `GET /guests` documents — but that window closes on its own as legacy
    // cookies age out, and it is strictly narrower than the status quo where
    // EVERY caller could do this on every request.
    if (!guestId && store) {
      const legacy = readLegacyUnsignedGuestCookieForBootstrap(c);
      if (legacy) {
        const upgraded = await c.env.runQuery(
          internal.storeFront.guest.resolveLegacyGuestForCookieUpgrade,
          { guestId: legacy, storeId: store._id },
        );
        if (upgraded && setSignedGuestCookie(c, upgraded)) {
          guestId = upgraded;
        }
      }
    }

    // A guest is only minted once the store is known: `guest.create` requires
    // a store, and a storeless guest can never be admitted by the rail.
    if (!accountId && !guestId && asNewUser === "true" && store) {
      // The marker is a session-recovery SECRET (see `isRecoverableGuestMarker`
      // in `http/utils.ts`): only a high-entropy marker is looked up, and only
      // within THIS store. Anything else — absent, empty, short — is no marker
      // at all: this shopper gets a fresh guest, never somebody else's row.
      // Resolving a marker hands out a signed session, which is why "no
      // marker" must never mean "the oldest marker-less guest".
      const recoverableMarker = isRecoverableGuestMarker(marker)
        ? marker
        : undefined;
      const guest =
        (recoverableMarker
          ? await c.env.runQuery(internal.storeFront.guest.getByMarker, {
              marker: recoverableMarker,
              storeId: store._id,
            })
          : null) ??
        (await c.env.runMutation(internal.storeFront.guest.create, {
          marker: recoverableMarker,
          creationOrigin: "storefront",
          storeId: store._id,
          organizationId: store.organizationId,
        }));

      // FAIL CLOSED with no signing secret: `setSignedGuestCookie` issues
      // nothing rather than hand out a cookie no consumer will accept. The
      // store cookies below and the store payload still go out, so anonymous
      // catalog browse keeps working in an unconfigured environment — only the
      // guest-identified paths go dark.
      if (guest) {
        setSignedGuestCookie(c, guest._id);
      }
    }

    if (store) {
      setCookie(c, "organization_id", store.organizationId, {
        path: "/",
        secure: true,
        domain: "wigclub.store",
        httpOnly: true,
        sameSite: "None",
        maxAge: 90 * 24 * 60 * 60, // 90 days in seconds
      });

      setCookie(c, "store_id", store._id, {
        path: "/",
        secure: true,
        domain: "wigclub.store",
        httpOnly: true,
        sameSite: "None",
        maxAge: 90 * 24 * 60 * 60, // 90 days in seconds
      });
    }

    return c.json(store);
  }),
);

storefrontRoutes.post(
  "/inventory/batch",
  admitHttpRoute(
    storefrontInventoryBatchRouteOperationDefinition,
    async (c, admitted) => {
      try {
        const body = parseIngressJson(admitted);
        const { skuIds } = body;

        if (!skuIds || !Array.isArray(skuIds)) {
          return c.json({ error: "skuIds array is required" }, 400);
        }

        const inventory = await c.env.runQuery(
          internal.inventory.productSku.getInventoryBySkuIdsInternal,
          {
            skuIds: skuIds as Array<Id<"productSku">>,
          },
        );

        return c.json({ inventory });
      } catch (error) {
        console.error("Failed to fetch batch inventory:", error);
        return c.json({ error: "Failed to fetch inventory data" }, 500);
      }
    },
  ),
);

export { storefrontRoutes };
