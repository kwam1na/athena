import { getClaimGuestIdFromIngressRequest } from "../../../utils";
import type { Id } from "../../../../_generated/dataModel";
import type { CustomerOwner } from "../../../../storeFront/customerOwnership";
import type {
  AdmittedHttpContext,
} from "../../../../operationAdmission/rail";
import type { OperationAdmissionProjection } from "../../../../operationAdmission/types";

/**
 * The admitted shopper, as the `owner` parameter internal callees expect.
 *
 * The rail resolved this from the claim cookie and derived the store from the
 * claim ROW, so it is the only identity a customer route may forward. A route
 * that reaches for `getStorefrontUserFromRequest` instead is handing a callee
 * whatever id the caller typed into a cookie.
 *
 * Throws rather than returning undefined: every call site here is behind a
 * definition that admits only `storefront_customer`, so a different actor kind
 * means the definition and the handler have drifted apart.
 */
export function admittedCustomerOwner(
  admission: OperationAdmissionProjection,
): CustomerOwner {
  const actor = admission.actor;
  if (actor.kind !== "storefront_customer") {
    throw new Error("This route requires an admitted storefront shopper.");
  }
  return {
    storeId: actor.storeId,
    ...(actor.storeFrontUserId
      ? { storeFrontUserId: actor.storeFrontUserId }
      : {}),
    ...(actor.guestId ? { guestId: actor.guestId } : {}),
  };
}

/** The shopper id the admitted claim resolved to. */
export function admittedCustomerActorId(
  admission: OperationAdmissionProjection,
): Id<"storeFrontUser"> | Id<"guest"> {
  const owner = admittedCustomerOwner(admission);
  const actorId = owner.storeFrontUserId ?? owner.guestId;
  if (!actorId) {
    throw new Error("This route requires an admitted storefront shopper.");
  }
  return actorId;
}

/**
 * The guest session the CALLER holds a cookie for, if any.
 *
 * Distinct from the actor's identity: a signed-in shopper's actor is their
 * account, and the guest cookie the browser still carries is not who they are
 * — it is what they possess. Merge callees need the second fact. Read from the
 * request rather than the actor so the actor's identity precedence (account
 * wins) is untouched.
 *
 * A merge bounded only by store let any signed-in shopper absorb a stranger's
 * guest history by posting that stranger's id; comparing against this value
 * refuses them, because they hold no such cookie.
 */
export function admittedClaimGuestId(
  admitted: AdmittedHttpContext,
): Id<"guest"> | undefined {
  return getClaimGuestIdFromIngressRequest(admitted.ingress.request);
}
