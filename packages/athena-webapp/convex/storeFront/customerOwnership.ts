import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

/**
 * Ownership propagation for storefront-reachable internal functions.
 *
 * A storefront shopper is admitted only at HTTP ingress (`http` / `http_read`),
 * where the rail resolves their `user_id` / `guest_id` cookie into a
 * `storefront_customer` actor. Internal Convex functions have no
 * `ctx.operationAdmission`, so the admitted identity travels to them as an
 * explicit `owner` parameter — never as a request-body field, and never
 * re-derived from a client-supplied argument.
 *
 * `assurance: "bearer_id"` means possession of an id proves nothing beyond
 * possession, so every internal callee that accepts a caller-supplied resource
 * id checks that id against `owner` here. A valid id for customer A must not
 * reach customer B's rows even when both shop the same store.
 *
 * Contract shape (the signature U10/U11 call):
 *
 *     owner: { storeFrontUserId?: Id<"storeFrontUser">; guestId?: Id<"guest">;
 *              storeId: Id<"store"> }
 *
 * Exactly one of `storeFrontUserId` / `guestId` is set — a shopper is either a
 * signed-in account or a guest marker, and the storefront adapter prefers the
 * account when a request carries both cookies.
 */

export const customerOwnerValidator = v.object({
  guestId: v.optional(v.id("guest")),
  storeFrontUserId: v.optional(v.id("storeFrontUser")),
  storeId: v.id("store"),
});

export type CustomerOwner = {
  guestId?: Id<"guest">;
  storeFrontUserId?: Id<"storeFrontUser">;
  storeId: Id<"store">;
};

/**
 * One message for every ownership refusal. The caller-visible text never names
 * the row that was asked for, so a probe cannot use the denial to learn whether
 * an id exists.
 */
export const CUSTOMER_OWNERSHIP_DENIED =
  "This storefront resource is not available for this shopper.";

export function denyCustomerOwnership(): never {
  throw new Error(CUSTOMER_OWNERSHIP_DENIED);
}

/** The storefront actor id the admitted claim resolved to. */
export function customerOwnerActorId(
  owner: CustomerOwner,
): Id<"storeFrontUser"> | Id<"guest"> {
  const actorId = owner.storeFrontUserId ?? owner.guestId;
  if (!actorId) denyCustomerOwnership();
  return actorId;
}

/** The store the admitted claim clamped to must be the row's store. */
export function assertCustomerOwnsStore(
  owner: CustomerOwner,
  storeId: Id<"store"> | string | undefined | null,
): void {
  if (!storeId || String(storeId) !== String(owner.storeId)) {
    denyCustomerOwnership();
  }
}

/**
 * The row must belong to the admitted shopper AND to the admitted store.
 *
 * `storeId` is checked when the row carries one: bags, saved bags, checkout
 * sessions and offers all do, while a join row such as `bagItem` inherits the
 * store from its parent and is checked through that parent instead.
 */
export function assertCustomerOwnsRow(
  owner: CustomerOwner,
  row:
    | {
        storeFrontUserId?: Id<"storeFrontUser"> | Id<"guest"> | string;
        storeId?: Id<"store"> | string;
      }
    | null
    | undefined,
): void {
  if (!row) denyCustomerOwnership();
  if (row.storeId !== undefined) {
    assertCustomerOwnsStore(owner, row.storeId);
  }
  if (
    row.storeFrontUserId === undefined ||
    String(row.storeFrontUserId) !== String(customerOwnerActorId(owner))
  ) {
    denyCustomerOwnership();
  }
}

/**
 * The optional form used by internal functions that already existed and are
 * still called by not-yet-migrated HTTP routes (wave B2 flips those call
 * sites). When `owner` is present the assertion is live; when it is absent the
 * callee keeps its pre-migration behaviour so the tree stays green between
 * waves. U10/U11 make every storefront-reachable call site pass it.
 */
export function assertCustomerOwnsRowIfPropagated(
  owner: CustomerOwner | undefined,
  row:
    | {
        storeFrontUserId?: Id<"storeFrontUser"> | Id<"guest"> | string;
        storeId?: Id<"store"> | string;
      }
    | null
    | undefined,
): void {
  if (!owner) return;
  assertCustomerOwnsRow(owner, row);
}

export function assertCustomerOwnsStoreIfPropagated(
  owner: CustomerOwner | undefined,
  storeId: Id<"store"> | string | undefined | null,
): void {
  if (!owner) return;
  assertCustomerOwnsStore(owner, storeId);
}
