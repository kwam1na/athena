import { Context } from "hono";
import { getCookie } from "hono/cookie";
import { Id } from "../_generated/dataModel";
import type { OperationIngressClaim } from "../operationAdmission/types";

export const getStoreDataFromRequest = (c: Context) => {
  const organizationId = getCookie(c, "organization_id") as Id<"organization">;
  const storeId = getCookie(c, "store_id") as Id<"store">;

  return { organizationId, storeId };
};

export const getStorefrontUserFromRequest = (c: Context) => {
  const userId = getCookie(c, "user_id") as Id<"storeFrontUser">;
  const guestId = getCookie(c, "guest_id") as Id<"guest">;

  return userId || guestId;
};

export const getStorefrontActorFromRequest = (c: Context) => {
  const userId = getCookie(c, "user_id") as Id<"storeFrontUser"> | undefined;
  if (userId) {
    return { kind: "storefrontUser" as const, id: userId };
  }

  const guestId = getCookie(c, "guest_id") as Id<"guest"> | undefined;
  if (guestId) {
    return { kind: "guest" as const, id: guestId };
  }

  return undefined;
};

/**
 * The ingress claim the admission rail resolves a `storefront_customer` actor
 * from.
 *
 * This reads cookies only. The `store_id` cookie is carried along so the
 * adapter can CROSS-CHECK it, never so it can decide the store: the admitted
 * store always comes from the claim row itself. A request with neither
 * `user_id` nor `guest_id` yields `undefined` — a customer write route treats
 * that as a terminal denial.
 *
 * BOTH cookies travel when both are present, but the adapter prefers the
 * account for ACTOR IDENTITY (see `resolveStorefrontCustomer`), so the guest
 * id is currently inert whenever a `user_id` cookie is also set.
 *
 * It is NOT possession evidence, and nothing downstream may treat it as such:
 * a cookie is caller-supplied, so a `guest_id` value proves only that the
 * caller typed it. The guest→account merge is authorized instead by a
 * server-issued grant written onto the guest ROW at sign-in — see
 * `storeFront/customerOwnership.ts`.
 */
export const getStorefrontClaimFromRequest = (
  c: Context,
): OperationIngressClaim | undefined => {
  const storeFrontUserId = getCookie(c, "user_id") as
    | Id<"storeFrontUser">
    | undefined;
  const guestId = getCookie(c, "guest_id") as Id<"guest"> | undefined;
  const storeId = getCookie(c, "store_id") as Id<"store"> | undefined;

  if (!storeFrontUserId && !guestId) return undefined;

  return {
    ...(storeFrontUserId ? { storeFrontUserId } : {}),
    ...(guestId ? { guestId } : {}),
    ...(storeId ? { storeId } : {}),
  };
};

/*
 * There was a `getClaimGuestIdFromIngressRequest` here, which hand-parsed the
 * ingress `Cookie` header so the merge callees could compare the body's guest
 * id against the cookie's. It is gone, and deliberately not replaced:
 *
 *  - it authorized nothing. Both operands were caller-supplied on the same
 *    request, so satisfying the check only required typing the same id twice;
 *  - its bare `decodeURIComponent` threw `URIError` on `guest_id=%`, turning a
 *    malformed cookie into a 500 on five routes. Every other cookie read in
 *    this file goes through Hono's guarded parser.
 *
 * The merge is authorized by the server-issued grant on the guest row
 * (`storeFront/customerOwnership.ts`). One mechanism, not two.
 */
