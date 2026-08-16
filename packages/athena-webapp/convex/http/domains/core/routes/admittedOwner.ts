import type { Id } from "../../../../_generated/dataModel";
import type { CustomerOwner } from "../../../../storeFront/customerOwnership";
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
