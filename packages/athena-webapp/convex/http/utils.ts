import { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { Id } from "../_generated/dataModel";
import type { OperationIngressClaim } from "../operationAdmission/types";
import {
  GUEST_COOKIE_NAME,
  type SignedGuestClaimFields,
  isUnsignedStorefrontCookieValue,
  readStorefrontCookieSecret,
  signStorefrontCookieValue,
  storefrontCookieSignature,
  verifyStorefrontCookieValue,
} from "../platform/storefrontCookieSignature";

export const getStoreDataFromRequest = (c: Context) => {
  const organizationId = getCookie(c, "organization_id") as Id<"organization">;
  const storeId = getCookie(c, "store_id") as Id<"store">;

  return { organizationId, storeId };
};

/**
 * The `guest_id` cookie, VERIFIED.
 *
 * A guest id is admitted only when the cookie carries a signature this server
 * minted for THIS cookie name (see `platform/storefrontCookieSignature`). An
 * unsigned cookie, a tampered one, and an unconfigured signing secret all
 * return `undefined` — the guest is ABSENT, which is a denial on a customer
 * write route and a fall-through to public on a browse read. None of them is
 * an error: a shopper holding a stale cookie is re-bootstrapped, not paged on.
 *
 * This is the single consumer-side gate. The only code allowed to look at the
 * RAW cookie is the bootstrap upgrade below.
 */
export const readVerifiedGuestIdFromRequest = (
  c: Context,
): Id<"guest"> | undefined => {
  const verified = verifyStorefrontCookieValue(
    GUEST_COOKIE_NAME,
    getCookie(c, GUEST_COOKIE_NAME),
    readStorefrontCookieSecret(),
  );
  return verified as Id<"guest"> | undefined;
};

/**
 * The RAW, UNVERIFIED `guest_id` cookie — for the one-time legacy upgrade and
 * nothing else.
 *
 * Deliberately long and unpleasant to type. It returns a value only when the
 * cookie is a LEGACY UNSIGNED one: a cookie that carries a signature but fails
 * verification is tampering, and tampering is never upgraded. The two
 * bootstrap routes (`GET /storefront`, `GET /guests`) are the only callers, and
 * they must re-check that the value names a real guest row IN THIS STORE
 * before re-minting it signed.
 *
 * It must never be called from `/auth/verify`, from a merge route, or from the
 * admission adapter. An upgrade at any of those points would hand the caller
 * back the ability to name any guest id they like, which is the hole this
 * whole mechanism closes.
 */
export const readLegacyUnsignedGuestCookieForBootstrap = (
  c: Context,
): string | undefined => {
  const raw = getCookie(c, GUEST_COOKIE_NAME);
  return isUnsignedStorefrontCookieValue(raw) ? raw : undefined;
};

/**
 * The guest MARKER is a session-recovery secret, or it is nothing.
 *
 * The storefront keeps a marker in `localStorage` and sends it to the two
 * bootstrap routes so a shopper whose `guest_id` cookie is gone can be handed
 * their previous guest row back — and, since the cookie is signed, a SIGNED
 * cookie for it. That makes "present the right marker" equivalent to "hold the
 * session": whoever resolves a marker walks away with a signed guest identity
 * they can then sign in on and merge into their own account.
 *
 * So the marker is only ever looked up when it is long enough that guessing
 * it is not a strategy. The storefront mints it with `crypto.randomUUID()`
 * (36 characters, 122 bits); anything shorter than {@link GUEST_MARKER_MIN_LENGTH}
 * — an absent marker, an empty one, or the ~5-character `Math.random()` markers
 * older clients kept — is treated as NO marker: a fresh guest is minted and
 * nothing is looked up. Absent must never mean "the marker-less guest": the
 * `by_marker` index happily matches `undefined`, and the oldest marker-less
 * row in the database is not this caller's session.
 *
 * `storeFront/guest:getByMarker` enforces the same rule server-side, so a
 * route cannot forget it, and additionally scopes the lookup to the store
 * being bootstrapped so a marker never resolves across stores.
 *
 * AT REST THE MARKER IS A HASH. Being a session secret, the raw marker is
 * never persisted: `guest.create` stores {@link hashGuestMarker} of it in the
 * `marker` column and `getByMarker` hashes the presented value before the
 * `by_marker` lookup. A guest document is read back whole by operator
 * surfaces (`storeFront/guest:getAll`, `storeFront/users:getByIds`, the
 * public `GET /guests`), and with only the digest on the row none of those
 * reads hands out anything a bootstrap route will resolve — presenting the
 * digest itself is hashed again and misses. Same shape as the shared-demo
 * ticket and the receipt-share token: mint raw, store SHA-256, compare
 * digests.
 */
export const GUEST_MARKER_MIN_LENGTH = 22;
const GUEST_MARKER_MAX_LENGTH = 128;
const GUEST_MARKER_SHAPE = /^[A-Za-z0-9_-]+$/;

export const isRecoverableGuestMarker = (
  marker: string | undefined,
): marker is string =>
  typeof marker === "string" &&
  marker.length >= GUEST_MARKER_MIN_LENGTH &&
  marker.length <= GUEST_MARKER_MAX_LENGTH &&
  GUEST_MARKER_SHAPE.test(marker);

/**
 * The value the `guest.marker` column holds for a raw marker: lowercase hex
 * SHA-256 (64 characters). Async because it goes through `crypto.subtle`,
 * which the Convex query/mutation runtime provides (see
 * `customerMessaging/token.ts`, used the same way from a `QueryCtx`).
 */
export async function hashGuestMarker(marker: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(marker),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

const STOREFRONT_COOKIE_OPTIONS = {
  path: "/",
  secure: true,
  domain: "wigclub.store",
  httpOnly: true,
  sameSite: "None",
  maxAge: 90 * 24 * 60 * 60, // 90 days in seconds
} as const;

/**
 * Mint the guest session cookie, SIGNED.
 *
 * Returns `false` when there is no signing secret, which is the fail-closed
 * path: rather than issue a cookie nothing downstream will accept, the
 * bootstrap route reports that guest sessions are unavailable. Anonymous
 * browse does not go through here and is unaffected.
 */
export const setSignedGuestCookie = (
  c: Context,
  guestId: Id<"guest"> | string,
): boolean => {
  const secret = readStorefrontCookieSecret();
  if (!secret) return false;

  setCookie(
    c,
    GUEST_COOKIE_NAME,
    signStorefrontCookieValue(GUEST_COOKIE_NAME, String(guestId), secret),
    STOREFRONT_COOKIE_OPTIONS,
  );
  return true;
};

export const getStorefrontUserFromRequest = (c: Context) => {
  const userId = getCookie(c, "user_id") as Id<"storeFrontUser">;
  const guestId = readVerifiedGuestIdFromRequest(c);

  return userId || guestId;
};

export const getStorefrontActorFromRequest = (c: Context) => {
  const userId = getCookie(c, "user_id") as Id<"storeFrontUser"> | undefined;
  if (userId) {
    return { kind: "storefrontUser" as const, id: userId };
  }

  const guestId = readVerifiedGuestIdFromRequest(c);
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
 * `user_id` nor a VERIFIED `guest_id` yields `undefined` — a customer write
 * route treats that as a terminal denial.
 *
 * BOTH cookies travel when both are present, but the adapter prefers the
 * account for ACTOR IDENTITY (see `resolveStorefrontCustomer`), so the guest
 * id is currently inert whenever a `user_id` cookie is also set.
 *
 * WHAT EACH HALF PROVES. `user_id` is still a bearer id: it is NOT signed
 * (that is V26-1240's job — signing it now would sign every shopper out with
 * no bootstrap route to re-mint it from), so possession of the string is all
 * it proves, and every callee still checks ownership against the admitted
 * actor. `guest_id` IS signed as of this change: an id here has a signature
 * this server minted, so it is evidence that the server issued this guest
 * session to this browser. That is what lets `/auth/verify` mint the
 * guest→account merge grant on it. The signature travels alongside as
 * `guestIdSignature` so the adapter can re-verify rather than inherit trust
 * from this function having run.
 */
export const getStorefrontClaimFromRequest = (
  c: Context,
): (OperationIngressClaim & SignedGuestClaimFields) | undefined => {
  const storeFrontUserId = getCookie(c, "user_id") as
    | Id<"storeFrontUser">
    | undefined;
  const guestId = readVerifiedGuestIdFromRequest(c);
  const storeId = getCookie(c, "store_id") as Id<"store"> | undefined;

  if (!storeFrontUserId && !guestId) return undefined;

  const secret = readStorefrontCookieSecret();

  return {
    ...(storeFrontUserId ? { storeFrontUserId } : {}),
    ...(guestId && secret
      ? {
          guestId,
          guestIdSignature: storefrontCookieSignature(
            GUEST_COOKIE_NAME,
            guestId,
            secret,
          ),
        }
      : {}),
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
 * (`storeFront/customerOwnership.ts`), and the grant in turn can only be minted
 * on a SIGNED guest session (`platform/storefrontCookieSignature.ts`). One
 * mechanism, not two.
 */
