import { CUSTOMER_OWNERSHIP_DENIED } from "../../../../storeFront/customerOwnership";
import type { Id } from "../../../../_generated/dataModel";
import type { AdmittedHttpContext } from "../../../../operationAdmission/rail";
import type { CustomerOwner } from "../../../../storeFront/customerOwnership";

/**
 * The single place a customer-channel route turns an admission into identity.
 *
 * Every `owner`, `storeFrontUserId` and `storeId` a route forwards to an
 * internal callee comes from here — that is, from the `storefront_customer`
 * actor the rail resolved out of the claim cookie — and never from the request
 * body, a path parameter, or a query string. A forged id in a payload can
 * therefore only ever be a *target* that the callee then checks against this
 * owner; it can never become the identity the check is made against.
 */

/**
 * The rail reads the request body exactly once and hands the same string to the
 * ingress verifier and to the handler, so handlers parse `ingress.rawBody`
 * rather than re-reading the consumed `Request`. A signature therefore covers
 * precisely the bytes the handler acts on.
 */
export function parseIngressJson<T = any>(admitted: AdmittedHttpContext): T {
  return JSON.parse(admitted.ingress.rawBody || "{}") as T;
}

export function admittedCustomerActor(admitted: AdmittedHttpContext) {
  const actor = admitted.admission.actor;
  return actor.kind === "storefront_customer" ? actor : undefined;
}

/**
 * The `owner` parameter every storefront-reachable internal function takes.
 *
 * Throws rather than returning a partial owner: a customer route is admitted
 * claim-only, so reaching a handler without a `storefront_customer` actor means
 * the definition and the handler disagree, and failing closed is the only safe
 * reading of that.
 */
export function requireAdmittedCustomerOwner(
  admitted: AdmittedHttpContext,
): CustomerOwner {
  const actor = admittedCustomerActor(admitted);
  if (!actor) {
    throw new Error("This request could not be verified.");
  }
  return {
    storeId: actor.storeId,
    ...(actor.storeFrontUserId
      ? { storeFrontUserId: actor.storeFrontUserId }
      : {}),
    ...(actor.guestId ? { guestId: actor.guestId } : {}),
  };
}

/**
 * The shopper id the admitted claim resolved to — a `storeFrontUser` id for a
 * signed-in shopper, a `guest` id otherwise. This is the value that used to be
 * read straight off the `user_id` / `guest_id` cookie by the route.
 */
export function admittedCustomerId(
  owner: CustomerOwner,
): Id<"storeFrontUser"> | Id<"guest"> {
  const actorId = owner.storeFrontUserId ?? owner.guestId;
  if (!actorId) {
    throw new Error("This request could not be verified.");
  }
  return actorId;
}

/**
 * The signed-in shopper id, or `undefined` for a guest. Routes that were
 * previously gated on "not a guest" branch on this.
 */
export function admittedStorefrontUserId(
  owner: CustomerOwner,
): Id<"storeFrontUser"> | undefined {
  return owner.storeFrontUserId;
}

/**
 * Did this error come from an ownership refusal, or is it a real fault?
 *
 * Routes that translate a denial into a 403 must not use a bare `catch {}` to
 * do it. A catch-all turns every bug in the callee — a validator mismatch, a
 * missing index, a thrown `TypeError` — into "Forbidden", which is both a lie
 * to the caller and an outage that monitoring cannot see, because 403 is an
 * expected status on these routes. It also makes any adjacent 404 unreachable:
 * a callee that throws instead of returning `null` never gets there.
 *
 * `CUSTOMER_OWNERSHIP_DENIED` is deliberately identical for a missing row and
 * a foreign row, so mapping it to 403 leaks nothing about which one it was.
 */
export function isCustomerOwnershipDenial(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes(CUSTOMER_OWNERSHIP_DENIED)
  );
}
