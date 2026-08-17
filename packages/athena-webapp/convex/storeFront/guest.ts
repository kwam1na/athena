import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
} from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { deleteGuestOperationDefinition } from "../operationAdmission/domains/u6_storefrontCustomer_definitions";
import {
  getAllGuestsReadDefinition,
  getReturningVisitorsForDayReadDefinition,
  getUniqueVisitorsForDayReadDefinition,
  getUniqueVisitorsReadDefinition,
} from "../operationAdmission/domains/u6_storefrontCustomer_readDefinitions";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import {
  GUEST_MERGE_GRANT_TTL_MS,
  GUEST_MERGE_KINDS,
  assertCustomerOwnsStore,
  customerOwnerActorId,
  customerOwnerOrServerInitiatedValidator,
  customerOwnerValidator,
  denyCustomerOwnership,
  isServerInitiated,
} from "./customerOwnership";

const entity = "guest";
const MAX_GUESTS = 5000;
const MAX_ANALYTICS_VISITORS = 2000;

export const getAll = query({
  args: {},
  handler: admitPublicQuery(getAllGuestsReadDefinition, async (ctx) => {
    return await ctx.db.query(entity).take(MAX_GUESTS);
  }),
});

/**
 * Read a guest row by id.
 *
 * `owner` is REQUIRED, but accepts `SERVER_INITIATED_OWNER`: the only caller,
 * the PUBLIC `GET /guests` bootstrap route, reads the guest id straight out of
 * a cookie and has no admitted owner to check it against.
 *
 * RESIDUAL RISK (known and accepted, not an oversight): because that route is
 * public by design — it exists so a shopper who has lost their session can
 * recover it, see the U10 scope decision — any caller may present an arbitrary
 * `guest_id` cookie and read back that guest row, including another shopper's.
 * This is an accepted IDOR on the guest record. Every path that carries a real
 * admitted claim must pass it rather than the sentinel.
 */
export const getById = internalQuery({
  args: {
    id: v.id(entity),
    owner: customerOwnerOrServerInitiatedValidator,
  },
  handler: async (ctx, args) => {
    if (
      !isServerInitiated(args.owner) &&
      String(args.id) !== String(customerOwnerActorId(args.owner))
    ) {
      denyCustomerOwnership();
    }
    return await ctx.db.get("guest", args.id);
  },
});

export const getByMarker = internalQuery({
  args: {
    marker: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const guest = await ctx.db
      .query(entity)
      .withIndex("by_marker", (q) => q.eq("marker", args.marker))
      .first();

    return guest;
  },
});

/**
 * `storeId` is REQUIRED here, which is the write half of the guest-store
 * tightening this unit ships.
 *
 * A guest row without a store cannot be clamped, so the storefront adapter
 * treats it as a terminal denial — a guest created storeless is a shopper who
 * can never be admitted again. Refusing at creation is what stops the backfill
 * from having to chase new rows, and the store is never defaulted: the caller
 * must know which storefront the visitor arrived at.
 *
 * Wave B2 (U10) updates the one caller that does not pass it today,
 * `POST /guests` in `http/domains/customerChannel/routes/guest.ts`, to pass the
 * store resolved from the request's `store_id` claim.
 */
export const create = internalMutation({
  args: {
    marker: v.optional(v.string()),
    creationOrigin: v.optional(v.string()),
    storeId: v.id("store"),
    organizationId: v.optional(v.id("organization")),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, {
      marker: args.marker,
      creationOrigin: args.creationOrigin,
      storeId: args.storeId,
      organizationId: args.organizationId,
    });

    return ctx.db.get("guest", id);
  },
});

/**
 * Resolve a LEGACY UNSIGNED `guest_id` cookie for the bootstrap re-mint.
 *
 * The only caller shape allowed is a BOOTSTRAP route (`GET /storefront`,
 * `GET /guests`) upgrading a pre-signing cookie so an existing shopper keeps
 * their cart. It answers a single question — "does this string name a real
 * guest row in this store?" — and returns the normalized id, never the row, so
 * nothing can grow into reading another shopper's guest record through it.
 *
 * `normalizeId` rather than a cast plus a bare `catch`: a hand-edited cookie is
 * then a typed MISS (`null`), not a swallowed fault, and a genuine database
 * failure still propagates instead of being rendered as "no such guest".
 *
 * This resolves; it does not authorize. Upgrading here is safe only because
 * bootstrap issues no grant and moves no rows: the upgraded cookie has to be
 * carried into a subsequent `/auth/verify` before it can authorize anything,
 * which is the same path a freshly minted guest takes.
 */
export const resolveLegacyGuestForCookieUpgrade = internalQuery({
  args: {
    guestId: v.string(),
    storeId: v.id("store"),
  },
  returns: v.union(v.id(entity), v.null()),
  handler: async (ctx, args) => {
    const guestId = ctx.db.normalizeId(entity, args.guestId);
    if (!guestId) return null;

    const guest = await ctx.db.get(entity, guestId);
    if (!guest) return null;
    if (String(guest.storeId ?? "") !== String(args.storeId)) return null;

    return guestId;
  },
});

/** Every merge kind consumed — the grant has nothing left to authorize. */
function grantIsFullyConsumed(consumed: string[] | undefined): boolean {
  const done = new Set(consumed ?? []);
  return GUEST_MERGE_KINDS.every((kind) => done.has(kind));
}

/**
 * Mint the server-issued guest→account MERGE GRANT.
 *
 * Called from `POST /auth/verify` immediately after `verifyCodeInternal` has
 * authenticated the account. This is the only writer of the grant columns, and
 * the one point in the system where the server sees the guest session and the
 * just-authenticated account together — which is exactly why the merge callees
 * can then authorize on the ROW instead of on something the caller presents.
 * See `customerOwnership.ts` for the full contract, including what this does
 * not buy.
 *
 * WHAT MAKES THE GUEST SIDE TRUSTWORTHY. The caller passes the guest id from
 * the request's `guest_id` cookie — but only after that cookie's SIGNATURE has
 * verified (`platform/storefrontCookieSignature.ts`). A caller who merely
 * knows another shopper's guest id cannot produce the signature, so they
 * cannot get a grant minted on that row. This closes the round-3 P0, where the
 * mint trusted the raw cookie. There is deliberately NO legacy-cookie upgrade
 * on this path: an unsigned cookie reaching sign-in mints nothing.
 *
 * Fail-soft rather than fail-loud: an unknown or foreign-store id is a
 * client-side defect, not a server fault — sign-in must still succeed, just
 * without a grant. Every fail-soft miss is LOGGED, because a silent `false`
 * here presents to the shopper as a cart that vanished at sign-in with nothing
 * in the record to explain it.
 *
 * Re-granting deliberately RESETS `mergeGrantConsumedBy`: a fresh
 * authenticated sign-in is a fresh authorization, so the shopper who signs in
 * twice still gets their five merges the second time. It does NOT re-point a
 * LIVE grant to a DIFFERENT account: if the row's current grant is unexpired
 * and still has merge kinds left, a second account signing in mid-sequence
 * would strand the first shopper's remaining merges at 403 halfway through
 * their own migration. Same account, expired, or fully consumed all re-grant
 * normally.
 */
export const grantMergeToStoreFrontUser = internalMutation({
  args: {
    // `v.string()`, not `v.id("guest")`, on purpose: this value originates as
    // cookie text. Declaring it as an id would make a hand-edited cookie fail
    // ARGUMENT VALIDATION — a fault the sign-in route would render as an
    // error response — instead of the no-op it should be.
    guestId: v.string(),
    owner: customerOwnerValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const storeFrontUserId = args.owner.storeFrontUserId;
    if (!storeFrontUserId) {
      console.warn("guest merge grant skipped: caller has no account");
      return false;
    }

    // A typed miss, not a swallowed throw: `normalizeId` answers `null` for a
    // string that is not an id of this table, and a real database fault still
    // propagates.
    const guestId = ctx.db.normalizeId(entity, args.guestId);
    if (!guestId) {
      console.warn("guest merge grant skipped: guest id is not a guest id");
      return false;
    }

    const guest = await ctx.db.get(entity, guestId);
    if (!guest) {
      console.warn("guest merge grant skipped: no such guest", { guestId });
      return false;
    }
    if (String(guest.storeId ?? "") !== String(args.owner.storeId)) {
      console.warn("guest merge grant skipped: guest belongs to another store", {
        guestId,
      });
      return false;
    }

    const existingAccount = guest.mergeGrantedToStoreFrontUserId;
    const grantIsLive =
      Boolean(existingAccount) &&
      (guest.mergeGrantExpiresAt ?? 0) >= Date.now() &&
      !grantIsFullyConsumed(guest.mergeGrantConsumedBy);
    if (
      grantIsLive &&
      String(existingAccount) !== String(storeFrontUserId)
    ) {
      console.warn(
        "guest merge grant skipped: a live grant for another account is mid-sequence",
        { guestId },
      );
      return false;
    }

    await ctx.db.patch(entity, guestId, {
      mergeGrantedToStoreFrontUserId: storeFrontUserId,
      mergeGrantExpiresAt: Date.now() + GUEST_MERGE_GRANT_TTL_MS,
      mergeGrantConsumedBy: [],
    });

    return true;
  },
});

async function deleteGuestWithCtx(ctx: MutationCtx, id: Id<"guest">) {
  await ctx.db.delete("guest", id);
  return { message: "Guest deleted" };
}

export const deleteGuest = mutation({
  args: {
    id: v.id(entity),
  },
  handler: admitPublicMutation(
    deleteGuestOperationDefinition,
    async (ctx, args: { id: Id<"guest"> }) => deleteGuestWithCtx(ctx, args.id),
  ),
});

export const update = internalMutation({
  args: {
    id: v.id(entity),
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    owner: customerOwnerValidator,
  },
  handler: async (ctx, args) => {
    // A guest may only ever patch their own row: the id in the path is
    // checked against the admitted claim, not merely trusted.
    if (String(args.id) !== String(customerOwnerActorId(args.owner))) {
      denyCustomerOwnership();
    }
    const guest = await ctx.db.get("guest", args.id);
    assertCustomerOwnsStore(args.owner, guest?.storeId);

    const updates: Record<string, any> = {};
    if (args.email) {
      updates.email = args.email;
    }
    if (args.firstName) {
      updates.firstName = args.firstName;
    }
    if (args.lastName) {
      updates.lastName = args.lastName;
    }
    if (args.phoneNumber) {
      updates.phoneNumber = args.phoneNumber;
    }
    await ctx.db.patch("guest", args.id, updates);
    return await ctx.db.get("guest", args.id);
  },
});

export const getUniqueVisitorsForDay = query({
  args: {
    storeId: v.id("store"),
    startTimeMs: v.number(),
    endTimeMs: v.number(),
  },
  handler: admitPublicQuery(
    getUniqueVisitorsForDayReadDefinition,
    async (
      ctx,
      args: { storeId: Id<"store">; startTimeMs: number; endTimeMs: number },
    ) => {
      const uniqueVisitors = await ctx.db
        .query(entity)
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .filter((q) =>
          q.and(
            q.gte(q.field("_creationTime"), args.startTimeMs),
            q.lt(q.field("_creationTime"), args.endTimeMs)
          )
        )
        .take(MAX_GUESTS);

      return uniqueVisitors.length;
    },
  ),
});

export const getUniqueVisitors = query({
  args: {
    storeId: v.id("store"),
    startTimeMs: v.number(),
  },
  handler: admitPublicQuery(
    getUniqueVisitorsReadDefinition,
    async (ctx, args: { storeId: Id<"store">; startTimeMs: number }) => {
      const uniqueVisitors = await ctx.db
        .query(entity)
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .filter((q) => q.gte(q.field("_creationTime"), args.startTimeMs))
        .take(MAX_GUESTS);

      return uniqueVisitors.length;
    },
  ),
});

export const getReturningVisitorsForDay = query({
  args: {
    storeId: v.id("store"),
    startTimeMs: v.number(),
    endTimeMs: v.number(),
  },
  returns: v.number(),
  handler: admitPublicQuery(
    getReturningVisitorsForDayReadDefinition,
    async (
      ctx,
      args: { storeId: Id<"store">; startTimeMs: number; endTimeMs: number },
    ) => {
    // Get all visitors with analytics activity today
    const analyticsToday = await ctx.db
      .query("analytics")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), args.startTimeMs),
          q.lt(q.field("_creationTime"), args.endTimeMs)
        )
      )
      .take(MAX_ANALYTICS_VISITORS);

    // Get unique visitor IDs from today's analytics
    const visitorIdsToday = new Set<Id<"storeFrontUser"> | Id<"guest">>();
    for (const analytic of analyticsToday) {
      if (analytic.storeFrontUserId) {
        visitorIdsToday.add(analytic.storeFrontUserId);
      }
    }

    // Count how many of these users also have analytics records from before today
    let returningVisitors = 0;
    for (const visitorId of visitorIdsToday) {
      const previousActivity = await ctx.db
        .query("analytics")
        .withIndex("by_storeFrontUserId_storeId", (q) =>
          q.eq("storeFrontUserId", visitorId).eq("storeId", args.storeId)
        )
        .filter((q) => q.lt(q.field("_creationTime"), args.startTimeMs))
        .first();

      if (previousActivity) {
        returningVisitors++;
      }
    }

    return returningVisitors;
    },
  ),
});
