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
    ...(guestId && !storeFrontUserId ? { guestId } : {}),
    ...(storeId ? { storeId } : {}),
  };
};
