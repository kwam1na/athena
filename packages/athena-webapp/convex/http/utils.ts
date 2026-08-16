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
 * BOTH cookies travel when both are present. A signed-in shopper mid-merge
 * still holds their guest cookie, and that cookie is the only proof they
 * possess the guest session they are asking to absorb. The adapter still
 * prefers the account for ACTOR IDENTITY (see `resolveStorefrontCustomer`);
 * the guest id rides along as evidence of possession, not as an identity.
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

/**
 * The `guest_id` cookie the caller actually presented, read off the ingress
 * `Request` the rail hands the handler.
 *
 * This is deliberately NOT an identity: `requireAdmittedCustomerOwner` still
 * derives the admitted shopper from the rail's actor. It is possession
 * evidence for the one operation that needs it — merging a guest session into
 * an account — where the question is not "who are you" but "do you hold this
 * guest session's cookie". Reading it here rather than off the actor keeps the
 * actor's identity precedence (account wins) untouched.
 */
export const getClaimGuestIdFromIngressRequest = (
  request: Request,
): Id<"guest"> | undefined => {
  const header = request.headers.get("cookie");
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== "guest_id") continue;
    const value = decodeURIComponent(part.slice(separator + 1).trim());
    return value ? (value as Id<"guest">) : undefined;
  }

  return undefined;
};
