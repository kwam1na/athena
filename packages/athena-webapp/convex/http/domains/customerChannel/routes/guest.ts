import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getCookie, setCookie } from "hono/cookie";
import { getStoreDataFromRequest } from "../../../utils";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";
import {
  createGuestRouteOperationDefinition,
  updateGuestRouteOperationDefinition,
} from "../../../../operationAdmission/domains/u10_httpCustomer_definitions";
import { getGuestRouteReadDefinition } from "../../../../operationAdmission/domains/u10_httpCustomer_readDefinitions";
import {
  parseIngressJson,
  requireAdmittedCustomerOwner,
} from "./admittedCustomer";

const guestRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Get all bags
guestRoutes.get(
  "/",
  admitHttpRead(getGuestRouteReadDefinition, async (c) => {
    // Deliberately public rather than claim-only: this is the route that
    // RECOVERS a stale or unknown guest cookie, so admitting it as a claim
    // would turn "unknown guest id" into a terminal denial and break the
    // bootstrap it exists for. The id is still read from the cookie, never
    // from the request, so no supplied id can select another shopper's row.
    const guestId = getCookie(c, "guest_id");

    const marker = c.req.query("marker");

    const { storeId, organizationId } = getStoreDataFromRequest(c);

    if (!guestId) {
      return c.json({ error: "Guest id missing" }, 404);
    }

    try {
      const guest = await c.env.runQuery(internal.storeFront.guest.getById, {
        id: guestId as Id<"guest">,
      });

      return c.json(guest);
    } catch (e) {
      if ((e as Error).message.includes("ArgumentValidationError")) {
        let guest = await c.env.runQuery(
          internal.storeFront.guest.getByMarker,
          { marker },
        );

        if (!guest) {
          // `guest.create` requires a store since U6 — a guest that cannot be
          // clamped to one can never be admitted, so refuse to mint it.
          if (!storeId) {
            return c.json({ error: "Store id missing" }, 404);
          }

          guest = await c.env.runMutation(internal.storeFront.guest.create, {
            marker,
            creationOrigin: "storefront",
            storeId: storeId as Id<"store">,
            organizationId,
          });
        }

        if (guest) {
          setCookie(c, "guest_id", guest?._id, {
            path: "/",
            secure: true,
            domain: "wigclub.store",
            httpOnly: true,
            sameSite: "None",
            maxAge: 90 * 24 * 60 * 60, // 90 days in seconds
          });
        }

        return c.json(guest);
      }

      return c.json({ error: (e as Error).message }, 400);
    }
  }),
);

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
