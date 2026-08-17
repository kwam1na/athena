import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

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

/* ------------------------------------------------ guest→account merge grant */

/**
 * A guest→account merge is authorized by a SERVER-ISSUED GRANT on the guest
 * row, never by anything the caller presents.
 *
 * Why this shape. The merge has to bound two ids that both arrive from the
 * client: the guest session being absorbed and the account absorbing it. The
 * account is fine — it is the admitted actor. The guest side was previously
 * bounded by comparing the body's guest id against the request's `guest_id`
 * COOKIE, which is not a bound at all: a cookie is caller-supplied, so both
 * operands came from the same request and any caller could satisfy it by
 * typing the same id twice.
 *
 * Instead, `POST /auth/verify` writes `mergeGrantedToStoreFrontUserId` onto the
 * guest row after it has authenticated the account. The merge callees read the
 * grant off the row. The caller supplies no evidence at all.
 *
 * WHAT THIS DOES AND DOES NOT BUY (stated plainly, because the previous round
 * shipped a comment asserting a guarantee the code did not have):
 *
 *  - It ends the "any signed-in shopper may absorb any guest id, at any time,
 *    with one request" shape. A merge is now possible only inside a 15-minute
 *    window opened by an authenticated sign-in, once per merge kind.
 *  - It does NOT make a guest id unguessable, and it does NOT prevent someone
 *    who knows a guest id from presenting that cookie WHILE signing in to their
 *    own account: `verifyCodeWithCtx` already treats the presented guest row as
 *    the row the new account inherits from, so that trust predates this change.
 *    Such a caller receives a grant on the guest they named. The store bound
 *    below still applies. This is the residual, and it is a bearer-id residual
 *    inherited from the sign-in flow — not something these callees can close.
 */
export const GUEST_MERGE_GRANT_TTL_MS = 15 * 60 * 1000;

/** The five merges the storefront fires after sign-in. Each is single-use. */
export const GUEST_MERGE_KINDS = [
  "bag",
  "savedBag",
  "onlineOrder",
  "analytics",
  "rewards",
] as const;

export type GuestMergeKind = (typeof GUEST_MERGE_KINDS)[number];

/**
 * The runtime twin of `GuestMergeKind`, for the one place a kind could ever
 * legitimately arrive as untrusted input. None of the five callees below take
 * `kind` as a client-supplied argument today — it is always a literal in the
 * callee's own code — but this validator exists so that if one ever does, an
 * invalid kind is a Convex argument-validation error rather than a string that
 * silently passes through.
 */
export const guestMergeKindValidator = v.union(
  ...GUEST_MERGE_KINDS.map((kind) => v.literal(kind)),
);

/**
 * The grant columns, as the merge callees see them on a loaded guest row.
 *
 * `mergeGrantConsumedBy` is typed as `GuestMergeKind[]`, not `string[]`: the
 * schema itself still stores a bare `v.array(v.string())` (schema.ts is a
 * shared file outside this module's edit surface), so this is a boundary
 * assertion, not a runtime guarantee from the database. It is sound because
 * `consumeGuestMergeGrant` below is the ONLY writer of this column, and it
 * only ever appends a `GuestMergeKind` literal.
 */
export type GuestMergeGrantRow = {
  mergeGrantedToStoreFrontUserId?: Id<"storeFrontUser">;
  mergeGrantExpiresAt?: number;
  mergeGrantConsumedBy?: GuestMergeKind[];
};

/**
 * Does the guest row carry a live, unconsumed grant for THIS account?
 *
 * Fail-closed on every axis: a missing row, an absent grant, a grant for a
 * different account, an expired grant, an already-consumed kind, and a caller
 * that is not a signed-in account all answer `false`.
 */
export function guestMergeGrantAuthorizes(
  guest: GuestMergeGrantRow | null | undefined,
  owner: CustomerOwner,
  kind: GuestMergeKind,
  now: number = Date.now(),
): boolean {
  if (!guest) return false;
  const account = owner.storeFrontUserId;
  if (!account) return false;
  if (!guest.mergeGrantedToStoreFrontUserId) return false;
  if (String(guest.mergeGrantedToStoreFrontUserId) !== String(account)) {
    return false;
  }
  if ((guest.mergeGrantExpiresAt ?? 0) < now) return false;
  return !(guest.mergeGrantConsumedBy ?? []).includes(kind);
}

/** `guestMergeGrantAuthorizes`, as the uniform ownership refusal. */
export function assertGuestMergeGranted(
  guest: GuestMergeGrantRow | null | undefined,
  owner: CustomerOwner,
  kind: GuestMergeKind,
): void {
  if (!guestMergeGrantAuthorizes(guest, owner, kind)) {
    denyCustomerOwnership();
  }
}

/**
 * The patch that marks this merge kind consumed.
 *
 * Returned as a value rather than applied here so the helper needs no Convex
 * ctx type: each callee applies it with its own `ctx.db.patch("guest", …)`
 * after the merge has actually succeeded.
 */
export function guestMergeGrantConsumedPatch(
  guest: GuestMergeGrantRow,
  kind: GuestMergeKind,
): { mergeGrantConsumedBy: GuestMergeKind[] } {
  const consumed = guest.mergeGrantConsumedBy ?? [];
  return {
    mergeGrantConsumedBy: consumed.includes(kind)
      ? consumed
      : [...consumed, kind],
  };
}

/**
 * The check-and-consume sequence every guest→account merge callee needs, in
 * one place instead of five.
 *
 * `bag.updateOwner`, `savedBag.updateOwner`, `onlineOrder.updateOwnerInternal`,
 * `analytics.updateOwnerInternal` and `rewards.awardPointsForGuestOrdersInternal`
 * each used to hand-repeat: load the guest row, assert the grant, assert the
 * store bound, then patch the consumed-by list. This is that sequence, once.
 *
 * It loads the guest row, then in order:
 *
 *  1. `assertGuestMergeGranted` — the grant must name `owner.storeFrontUserId`,
 *     be unexpired, and not already list `kind` as consumed. Denies otherwise.
 *  2. `assertCustomerOwnsStore` — the store bound is kept ON TOP OF the grant,
 *     not replaced by it: a grant minted for the right account on a guest row
 *     from a different store still does not authorize the merge.
 *  3. Records consumption of `kind` on the guest row. This happens inside the
 *     caller's own mutation transaction (Convex mutations are transactional),
 *     so a later throw in the caller's own merge work rolls the consumption
 *     back with it — a merge that returns is a merge that consumed its grant,
 *     and a merge that throws consumes nothing.
 *
 * Returns the loaded guest row so a callee that needs more than the
 * authorization decision (e.g. `rewards` needs `guest.email`) does not have
 * to fetch it a second time.
 */
export async function consumeGuestMergeGrant(
  ctx: MutationCtx,
  args: { guestId: Id<"guest">; owner: CustomerOwner; kind: GuestMergeKind },
): Promise<Doc<"guest">> {
  const guest = await ctx.db.get("guest", args.guestId);

  // `mergeGrantConsumedBy` is stored as a bare `string[]` in the schema (a
  // shared file outside this module's edit surface); this module is the only
  // writer of it, so treating a freshly-loaded row as a `GuestMergeGrantRow`
  // is sound even though the two types are not structurally assignable.
  const grantView = guest as unknown as GuestMergeGrantRow | null;

  assertGuestMergeGranted(grantView, args.owner, args.kind);
  assertCustomerOwnsStore(args.owner, guest?.storeId);

  await ctx.db.patch(
    "guest",
    args.guestId,
    guestMergeGrantConsumedPatch(grantView!, args.kind),
  );

  // `assertGuestMergeGranted` denies (throws) whenever `guest` is nullish, so
  // reaching here means the row exists.
  return guest!;
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
