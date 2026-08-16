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
 * An explicitly unowned call: no customer actor exists for this path.
 *
 * Required rather than optional so that "no ownership check here" is a
 * deliberate, greppable decision at the call site instead of an omitted
 * argument that silently skips the assertion.
 */
export const SERVER_INITIATED_OWNER = { kind: "server_initiated" } as const;

export type CustomerOwnerOrServerInitiated =
  | CustomerOwner
  | typeof SERVER_INITIATED_OWNER;

export const customerOwnerOrServerInitiatedValidator = v.union(
  customerOwnerValidator,
  v.object({ kind: v.literal("server_initiated") }),
);

/** Narrow the sentinel apart from a real admitted claim. */
export function isServerInitiated(
  owner: CustomerOwnerOrServerInitiated,
): owner is typeof SERVER_INITIATED_OWNER {
  return "kind" in owner && owner.kind === "server_initiated";
}

/**
 * `assertCustomerOwnsRow`, but skipping the check for — and ONLY for — the
 * explicit `SERVER_INITIATED_OWNER` sentinel. Any real claim is asserted.
 */
export function assertCustomerOwnsRowUnlessServerInitiated(
  owner: CustomerOwnerOrServerInitiated,
  row:
    | {
        storeFrontUserId?: Id<"storeFrontUser"> | Id<"guest"> | string;
        storeId?: Id<"store"> | string;
      }
    | null
    | undefined,
): void {
  if (isServerInitiated(owner)) return;
  assertCustomerOwnsRow(owner, row);
}

/**
 * `assertCustomerOwnsStore`, but skipping the check for — and ONLY for — the
 * explicit `SERVER_INITIATED_OWNER` sentinel. Any real claim is asserted.
 */
export function assertCustomerOwnsStoreUnlessServerInitiated(
  owner: CustomerOwnerOrServerInitiated,
  storeId: Id<"store"> | string | undefined | null,
): void {
  if (isServerInitiated(owner)) return;
  assertCustomerOwnsStore(owner, storeId);
}
