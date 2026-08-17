// @vitest-environment node
/// <reference types="vite/client" />

/**
 * The guest→account merge, driven through the EXPORTED routers with FORGED
 * COOKIES, against a real database.
 *
 * This file exists because the previous two rounds were tested at the wrong
 * layer. Round 1 bounded the merge by store; round 2 bounded it by comparing
 * the body's guest id against the request's `guest_id` COOKIE and asserted
 * possession in its comments. Both rounds' tests passed the "evidence" as a
 * FUNCTION ARGUMENT, which cannot express the actual threat: the attacker does
 * not call the mutation, they send an HTTP request, and on that request both
 * sides of the round-2 comparison were theirs to write.
 *
 * So every test here builds a `Request` with a `Cookie` header and calls
 * `<router>.fetch(request, env)`, where `env` runs the REAL admission rail and
 * the REAL internal mutations against a `convexTest` database. The attack the
 * reviewers described is spelled out literally:
 *
 *     Cookie: user_id=<attacker account>; guest_id=<victim guest>
 *     {"currentOwnerId": "<victim guest>"}
 *
 * and the victim's rows are read back afterwards to prove nothing moved.
 */

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import { internal } from "../../../../_generated/api";
import type { Id } from "../../../../_generated/dataModel";
import schema from "../../../../schema";

import {
  GUEST_COOKIE_NAME,
  STOREFRONT_COOKIE_SECRET_ENV,
  signStorefrontCookieValue,
  verifyStorefrontCookieValue,
} from "../../../../platform/storefrontCookieSignature";

import { hashGuestMarker } from "../../../utils";
import { analyticsRoutes } from "../../core/routes/analytics";
import { authRoutes } from "../../core/routes/auth";
import { bagRoutes } from "./bag";
import { onlineOrderRoutes } from "./onlineOrder";
import { guestRoutes } from "./guest";
import { rewardsRoutes } from "./rewards";
import { savedBagRoutes } from "./savedBag";
import { storefrontRoutes } from "./storefront";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../../../../**/*.ts")).map(
    ([path, loader]) => [path.replace(/^(\.\.\/){4}/, "./"), loader],
  ),
);

const ALLOWED_ORIGIN = "https://shop.test";
const ORIGIN_ENV = "ATHENA_STOREFRONT_ALLOWED_ORIGINS";

/**
 * The signing secret for the `guest_id` cookie. A guest session is only a
 * claim — and only grantable — when it carries this signature, which is what
 * separates "the server issued this session to this browser" from "the caller
 * typed an id".
 */
const COOKIE_SECRET = "test-storefront-cookie-secret";

/** A `guest_id` cookie as the two bootstrap routes mint it. */
const signedGuest = (guestId: string) =>
  `guest_id=${signStorefrontCookieValue(GUEST_COOKIE_NAME, guestId, COOKIE_SECRET)}`;

const withOrigin = async (
  run: () => Promise<void>,
  { secret = COOKIE_SECRET }: { secret?: string } = {},
) => {
  vi.stubEnv(ORIGIN_ENV, ALLOWED_ORIGIN);
  vi.stubEnv(STOREFRONT_COOKIE_SECRET_ENV, secret);
  try {
    await run();
  } finally {
    vi.unstubAllEnvs();
  }
};

/** The `guest_id` value a route just set, if it set one. */
function guestCookieFromResponse(response: Response): string | undefined {
  const headers =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""];

  for (const header of headers) {
    for (const part of header.split(/,(?=[^;]+?=)/)) {
      const match = part.trim().match(/^guest_id=([^;]*)/);
      if (match) return decodeURIComponent(match[1]);
    }
  }
  return undefined;
}

/** Hono `env` backed by the real database and the real admission rail. */
function envFor(t: ReturnType<typeof convexTest>) {
  return {
    runQuery: (ref: any, args: any) => t.query(ref, args),
    runMutation: (ref: any, args: any) => t.mutation(ref, args),
    runAction: (ref: any, args: any) => t.action(ref, args),
  } as never;
}

function request(
  path: string,
  options: {
    body?: unknown;
    cookie: string;
    method?: string;
    rawBody?: string;
  },
) {
  const headers = new Headers({
    "Content-Type": "application/json",
    Cookie: options.cookie,
    Origin: ALLOWED_ORIGIN,
  });
  return new Request(`https://api.test${path}`, {
    method: options.method ?? "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(options.body ?? {}),
  });
}

/**
 * Two shoppers in one store, plus a second store.
 *
 * `victim` is a guest with a bag, a saved bag, an order and an analytics row.
 * `attacker` is a signed-in account in the SAME store — the round-1/round-2
 * attacker exactly: same tenant, no relationship to the victim's session.
 */
async function seed() {
  const t = convexTest(schema, modules);

  const fixture = await t.run(async (ctx) => {
    const athenaUserId = await ctx.db.insert("athenaUser", {
      email: "operator@test",
      normalizedEmail: "operator@test",
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: athenaUserId,
      name: "org",
      slug: "org",
    });
    const storeId = await ctx.db.insert("store", {
      createdByUserId: athenaUserId,
      currency: "GHS",
      name: "store",
      organizationId,
      slug: "store",
    });
    const otherStoreId = await ctx.db.insert("store", {
      createdByUserId: athenaUserId,
      currency: "GHS",
      name: "other",
      organizationId,
      slug: "other",
    });

    const victim = await ctx.db.insert("guest", {
      marker: "victim",
      organizationId,
      storeId,
    });
    const attacker = await ctx.db.insert("storeFrontUser", {
      email: "mallory@test",
      organizationId,
      storeId,
    });

    const victimBag = await ctx.db.insert("bag", {
      items: [],
      storeFrontUserId: victim,
      storeId,
      updatedAt: Date.now(),
    });
    const victimSavedBag = await ctx.db.insert("savedBag", {
      items: [],
      storeFrontUserId: victim,
      storeId,
      updatedAt: Date.now(),
    });
    const victimCheckoutSession = await ctx.db.insert("checkoutSession", {
      amount: 1000,
      bagId: victimBag,
      billingDetails: null,
      customerDetails: null,
      deliveryDetails: null,
      deliveryFee: null,
      deliveryInstructions: null,
      deliveryOption: null,
      discount: null,
      expiresAt: Date.now() + 60_000,
      hasCompletedCheckoutSession: true,
      hasCompletedPayment: true,
      hasVerifiedPayment: true,
      isFinalizingPayment: false,
      pickupLocation: null,
      storeFrontUserId: victim,
      storeId,
    });
    const victimOrder = await ctx.db.insert("onlineOrder", {
      amount: 1000,
      bagId: victimBag,
      billingDetails: null,
      checkoutSessionId: victimCheckoutSession,
      customerDetails: {
        email: "victim@test",
        firstName: "Vic",
        lastName: "Tim",
        phoneNumber: "+233000000000",
      },
      deliveryDetails: null,
      deliveryFee: null,
      deliveryInstructions: null,
      deliveryMethod: "pickup",
      deliveryOption: null,
      discount: null,
      hasVerifiedPayment: true,
      items: [],
      orderNumber: "ORD-1",
      pickupLocation: null,
      status: "open",
      storeFrontUserId: victim,
      storeId,
    });
    const victimAnalytics = await ctx.db.insert("analytics", {
      action: "viewed_product",
      data: {},
      device: "desktop",
      storeFrontUserId: victim,
      storeId,
    });

    return {
      attacker,
      organizationId,
      otherStoreId,
      storeId,
      victim,
      victimAnalytics,
      victimBag,
      victimOrder,
      victimSavedBag,
    };
  });

  return { t, ...fixture };
}

type Seed = Awaited<ReturnType<typeof seed>>;

/** Where each of the victim's rows currently lives. */
async function ownership(s: Seed) {
  return s.t.run(async (ctx) => ({
    analytics: String(
      (await ctx.db.get("analytics", s.victimAnalytics))?.storeFrontUserId,
    ),
    bag: String((await ctx.db.get("bag", s.victimBag))?.storeFrontUserId),
    order: String(
      (await ctx.db.get("onlineOrder", s.victimOrder))?.storeFrontUserId,
    ),
    savedBag: String(
      (await ctx.db.get("savedBag", s.victimSavedBag))?.storeFrontUserId,
    ),
  }));
}

/** The five merge requests, as the storefront actually issues them. */
function mergeRequests(s: Seed, cookie: string, guestId: Id<"guest">) {
  return [
    {
      name: "bag",
      router: bagRoutes,
      request: request(`/${s.victimBag}/owner`, {
        cookie,
        body: { currentOwnerId: guestId },
      }),
    },
    {
      name: "savedBag",
      router: savedBagRoutes,
      request: request(`/${s.victimSavedBag}/owner`, {
        cookie,
        body: { currentOwnerId: guestId },
      }),
    },
    {
      name: "onlineOrder",
      router: onlineOrderRoutes,
      request: request("/owner", {
        cookie,
        body: { currentOwnerId: guestId },
      }),
    },
    {
      name: "analytics",
      router: analyticsRoutes,
      request: request("/update-owner", { cookie, body: { guestId } }),
    },
    {
      name: "rewards",
      router: rewardsRoutes,
      request: request("/award-guest-orders", { cookie, body: { guestId } }),
    },
  ];
}

/** Sign in through the real route, which is what mints the grant. */
async function signIn(
  s: Seed,
  email: string,
  cookie: string,
  // A verification code is single-use, so a second sign-in for the same
  // shopper needs a fresh one.
  code = "123456",
): Promise<Response> {
  await s.t.run((ctx) =>
    ctx.db.insert("storeFrontVerificationCode", {
      code,
      email,
      expiration: Date.now() + 10 * 60 * 1000,
      isUsed: false,
      storeId: s.storeId,
    }),
  );

  return authRoutes.fetch(
    request("/verify", {
      cookie,
      body: { code, email },
    }),
    envFor(s.t),
  );
}

describe("guest→account merge is authorized by a server-issued grant", () => {
  /**
   * THE ATTACK. A signed-in shopper who knows a guest id sets it as their own
   * `guest_id` cookie and names it in the body. Under round 2 this satisfied
   * `claimGuestId === currentOwner` and all five merges succeeded.
   */
  it("denies a forged `guest_id` cookie on all five merges and moves nothing", async () => {
    await withOrigin(async () => {
      const s = await seed();
      const before = await ownership(s);

      const cookie = `user_id=${s.attacker}; guest_id=${s.victim}; store_id=${s.storeId}`;

      for (const merge of mergeRequests(s, cookie, s.victim)) {
        const response = await merge.router.fetch(merge.request, envFor(s.t));
        expect({ merge: merge.name, status: response.status }).toEqual({
          merge: merge.name,
          status: 403,
        });
        expect({ merge: merge.name, body: await response.json() }).toEqual({
          merge: merge.name,
          body: { error: "Forbidden" },
        });
      }

      // The rows the attacker was after: orders (delivery addresses, phone
      // numbers), reward points, analytics and cart. None of them moved.
      expect(await ownership(s)).toEqual(before);
      expect(before).toEqual({
        analytics: String(s.victim),
        bag: String(s.victim),
        order: String(s.victim),
        savedBag: String(s.victim),
      });
    });
  });

  /**
   * The legitimate flow, end to end: sign in (which mints the grant), then
   * merge. Post-merge ownership is asserted — "nothing threw" would pass even
   * if every callee silently returned null.
   */
  it("mints a grant at sign-in and the five merges then actually move the rows", async () => {
    await withOrigin(async () => {
      const s = await seed();

      const guestCookie = `${signedGuest(s.victim)}; store_id=${s.storeId}; organization_id=${s.organizationId}`;
      const signInResponse = await signIn(s, "shopper@test", guestCookie);
      expect(signInResponse.status).toBe(200);
      const account = (await signInResponse.json()).user._id as
        | Id<"storeFrontUser">
        | undefined;
      expect(account).toBeDefined();

      // The grant is on the ROW, written by the server. Nothing the caller
      // sent produced it.
      const grant = await s.t.run((ctx) => ctx.db.get("guest", s.victim));
      expect(String(grant?.mergeGrantedToStoreFrontUserId)).toBe(
        String(account),
      );
      expect(grant?.mergeGrantExpiresAt).toBeGreaterThan(Date.now());

      const cookie = `user_id=${account}; ${signedGuest(s.victim)}; store_id=${s.storeId}`;
      for (const merge of mergeRequests(s, cookie, s.victim)) {
        const response = await merge.router.fetch(merge.request, envFor(s.t));
        expect({ merge: merge.name, status: response.status }).toEqual({
          merge: merge.name,
          status: 200,
        });
      }

      // The rows MOVED. This is the assertion the previous rounds lacked.
      expect(await ownership(s)).toEqual({
        analytics: String(account),
        bag: String(account),
        order: String(account),
        savedBag: String(account),
      });
    });
  });

  it("denies a second merge of the same kind under one grant", async () => {
    await withOrigin(async () => {
      const s = await seed();

      const guestCookie = `${signedGuest(s.victim)}; store_id=${s.storeId}; organization_id=${s.organizationId}`;
      const signInResponse = await signIn(s, "replay@test", guestCookie);
      const account = (await signInResponse.json()).user._id;

      const cookie = `user_id=${account}; ${signedGuest(s.victim)}; store_id=${s.storeId}`;
      const [bagMerge] = mergeRequests(s, cookie, s.victim);

      expect(
        (await bagRoutes.fetch(bagMerge.request, envFor(s.t))).status,
      ).toBe(200);

      // Same grant, same kind, second time: the grant is consumed.
      const replay = mergeRequests(s, cookie, s.victim)[0];
      expect((await bagRoutes.fetch(replay.request, envFor(s.t))).status).toBe(
        403,
      );
    });
  });

  it("denies an EXPIRED grant", async () => {
    await withOrigin(async () => {
      const s = await seed();

      const guestCookie = `${signedGuest(s.victim)}; store_id=${s.storeId}; organization_id=${s.organizationId}`;
      const signInResponse = await signIn(s, "expired@test", guestCookie);
      const account = (await signInResponse.json()).user._id;

      await s.t.run((ctx) =>
        ctx.db.patch("guest", s.victim, {
          mergeGrantExpiresAt: Date.now() - 1,
        }),
      );

      const cookie = `user_id=${account}; ${signedGuest(s.victim)}; store_id=${s.storeId}`;
      for (const merge of mergeRequests(s, cookie, s.victim)) {
        const response = await merge.router.fetch(merge.request, envFor(s.t));
        expect({ merge: merge.name, status: response.status }).toEqual({
          merge: merge.name,
          status: 403,
        });
      }
      expect(await ownership(s)).toEqual({
        analytics: String(s.victim),
        bag: String(s.victim),
        order: String(s.victim),
        savedBag: String(s.victim),
      });
    });
  });

  it("does not let a grant issued to a DIFFERENT account authorize this caller", async () => {
    await withOrigin(async () => {
      const s = await seed();

      // The victim signed in legitimately, so their guest row carries a grant
      // — for THEIR account. The attacker rides in on the same guest id.
      const guestCookie = `${signedGuest(s.victim)}; store_id=${s.storeId}; organization_id=${s.organizationId}`;
      await signIn(s, "victim@test", guestCookie);

      // The attacker holds a genuinely SIGNED cookie for the victim's guest
      // session, so the denial here is the grant's account check doing its
      // job, not the signature check standing in for it.
      const cookie = `user_id=${s.attacker}; ${signedGuest(s.victim)}; store_id=${s.storeId}`;
      for (const merge of mergeRequests(s, cookie, s.victim)) {
        const response = await merge.router.fetch(merge.request, envFor(s.t));
        expect({ merge: merge.name, status: response.status }).toEqual({
          merge: merge.name,
          status: 403,
        });
      }
      expect(await ownership(s)).toEqual({
        analytics: String(s.victim),
        bag: String(s.victim),
        order: String(s.victim),
        savedBag: String(s.victim),
      });
    });
  });

  it("keeps the cross-store bound on top of the grant", async () => {
    await withOrigin(async () => {
      const s = await seed();

      // A guest in the OTHER store, granted to an account in THIS store. The
      // grant is store-bounded at mint; the callees re-check it anyway.
      const foreignGuest = await s.t.run(async (ctx) => {
        const id = await ctx.db.insert("guest", {
          marker: "foreign",
          organizationId: s.organizationId,
          storeId: s.otherStoreId,
        });
        await ctx.db.patch("guest", id, {
          mergeGrantedToStoreFrontUserId: s.attacker,
          mergeGrantExpiresAt: Date.now() + 15 * 60 * 1000,
          mergeGrantConsumedBy: [],
        });
        return id;
      });

      const cookie = `user_id=${s.attacker}; ${signedGuest(foreignGuest)}; store_id=${s.storeId}`;
      for (const merge of mergeRequests(s, cookie, foreignGuest)) {
        const response = await merge.router.fetch(merge.request, envFor(s.t));
        expect({ merge: merge.name, status: response.status }).toEqual({
          merge: merge.name,
          status: 403,
        });
      }
    });
  });

  /**
   * `guest_id=%` used to reach a bare `decodeURIComponent` and throw `URIError`
   * on five routes. The hand-rolled parser is gone, so an undecodable cookie is
   * simply an absent claim — a denial, never a server fault.
   */
  it("treats a malformed guest_id cookie as absent rather than throwing", async () => {
    await withOrigin(async () => {
      const s = await seed();

      const cookie = `user_id=${s.attacker}; guest_id=%; store_id=${s.storeId}`;
      for (const merge of mergeRequests(s, cookie, s.victim)) {
        const response = await merge.router.fetch(merge.request, envFor(s.t));
        expect({ merge: merge.name, status: response.status }).toEqual({
          merge: merge.name,
          status: 403,
        });
      }
    });
  });

  /**
   * The merge body's guest id is still caller-supplied — it names the TARGET
   * row, and the callee's `v.id("guest")` argument validator is the thing
   * that used to reject a non-id string. That validator raises rather than
   * denies, and the route's ownership-only `catch` used to rethrow it,
   * turning a client typo into a 500 that clients retry and monitoring pages
   * on. It must be a 400, on every one of the five merge routes.
   */
  it("answers 400, not 500, for a non-id guest id in the merge body", async () => {
    await withOrigin(async () => {
      const s = await seed();
      const before = await ownership(s);

      // No guest cookie at all: the attacker is simply a signed-in shopper
      // POSTing a garbage id as the merge target.
      const cookie = `user_id=${s.attacker}; store_id=${s.storeId}`;
      const bogus = "not-an-id" as Id<"guest">;

      for (const merge of mergeRequests(s, cookie, bogus)) {
        const response = await merge.router.fetch(merge.request, envFor(s.t));
        expect({ merge: merge.name, status: response.status }).toEqual({
          merge: merge.name,
          status: 400,
        });
      }

      // Terminal: a malformed id never reaches a row, so nothing moved.
      expect(await ownership(s)).toEqual(before);
    });
  });

  it("denies sign-in when the only claim is an unusable guest_id cookie, without a 500", async () => {
    await withOrigin(async () => {
      const s = await seed();

      const response = await signIn(
        s,
        "garbage-cookie@test",
        `guest_id=not-an-id; store_id=${s.storeId}; organization_id=${s.organizationId}`,
      );

      // No claim resolves from an unparseable cookie, so the route denies —
      // what matters is that it is a denial, not a 500 from a thrown id parse.
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    });
  });
});

/**
 * The guest session as a SERVER-ISSUED CREDENTIAL.
 *
 * Rounds 1-3 all failed the same way: whatever the merge checked, the guest
 * side of it was a value the caller wrote. Round 3's grant fixed the merge and
 * moved the problem one request earlier — the grant itself was minted from the
 * raw `guest_id` cookie, so presenting a victim's guest id while signing in to
 * your own account bought you a grant on their row.
 *
 * These tests pin the fix: `guest_id` is signed at the two bootstrap points,
 * and only a signature the server minted makes a guest id usable anywhere.
 */
describe("the guest session is a signed, server-issued cookie", () => {
  const getRequest = (path: string, cookie?: string) =>
    new Request(`https://api.test${path}`, {
      method: "GET",
      headers: new Headers({
        Origin: ALLOWED_ORIGIN,
        ...(cookie ? { Cookie: cookie } : {}),
      }),
    });

  /** THE ROUND-3 ATTACK, in both of its shapes. */
  it("mints NO grant when sign-in presents a forged guest cookie, and the merges stay denied", async () => {
    const forgeries = [
      {
        name: "unsigned victim id",
        cookie: (s: Seed) => `guest_id=${s.victim}`,
      },
      {
        name: "victim id signed with the wrong secret",
        cookie: (s: Seed) =>
          `guest_id=${signStorefrontCookieValue(
            GUEST_COOKIE_NAME,
            s.victim,
            "not-the-servers-secret",
          )}`,
      },
    ];

    for (const forgery of forgeries) {
      await withOrigin(async () => {
        const s = await seed();
        const before = await ownership(s);

        // The attacker signs in to their OWN account — admitted on their own
        // `user_id` — while presenting the victim's guest id.
        const signInResponse = await signIn(
          s,
          "mallory@test",
          `user_id=${s.attacker}; ${forgery.cookie(s)}; store_id=${s.storeId}; organization_id=${s.organizationId}`,
        );
        expect({ forgery: forgery.name, status: signInResponse.status }).toEqual(
          { forgery: forgery.name, status: 200 },
        );

        // NO grant was written on the victim's row.
        const guest = await s.t.run((ctx) => ctx.db.get("guest", s.victim));
        expect({
          forgery: forgery.name,
          grant: guest?.mergeGrantedToStoreFrontUserId ?? null,
        }).toEqual({ forgery: forgery.name, grant: null });

        // And the five merges deny, with or without the forged cookie.
        const cookie = `user_id=${s.attacker}; ${forgery.cookie(s)}; store_id=${s.storeId}`;
        for (const merge of mergeRequests(s, cookie, s.victim)) {
          const response = await merge.router.fetch(merge.request, envFor(s.t));
          expect({ merge: merge.name, status: response.status }).toEqual({
            merge: merge.name,
            status: 403,
          });
        }

        expect(await ownership(s)).toEqual(before);
      });
    }
  });

  it("mints a SIGNED guest cookie at the storefront bootstrap", async () => {
    await withOrigin(async () => {
      const s = await seed();

      const response = await storefrontRoutes.fetch(
        getRequest("/?storeName=store&asNewUser=true"),
        envFor(s.t),
      );
      expect(response.status).toBe(200);

      const cookie = guestCookieFromResponse(response);
      const guestId = verifyStorefrontCookieValue(
        GUEST_COOKIE_NAME,
        cookie,
        COOKIE_SECRET,
      );

      // The cookie is not the bare id, and what it carries is a real row.
      expect(cookie).toBeDefined();
      expect(cookie).not.toBe(guestId);
      expect(guestId).toBeDefined();
      const row = await s.t.run((ctx) =>
        ctx.db.get("guest", guestId as Id<"guest">),
      );
      expect(String(row?.storeId)).toBe(String(s.storeId));
    });
  });

  /**
   * The legacy path: a shopper whose cookie predates signing keeps their cart.
   * Bootstrap re-mints it signed, and from there the ordinary flow works.
   */
  it("upgrades a legacy unsigned cookie at bootstrap, and the upgraded session then merges", async () => {
    await withOrigin(async () => {
      const s = await seed();

      const bootstrap = await guestRoutes.fetch(
        getRequest(
          "/",
          `guest_id=${s.victim}; store_id=${s.storeId}; organization_id=${s.organizationId}`,
        ),
        envFor(s.t),
      );
      expect(bootstrap.status).toBe(200);

      // The SAME guest row comes back, now behind a signature.
      const upgraded = guestCookieFromResponse(bootstrap);
      expect(
        verifyStorefrontCookieValue(GUEST_COOKIE_NAME, upgraded, COOKIE_SECRET),
      ).toBe(String(s.victim));

      const signInResponse = await signIn(
        s,
        "legacy@test",
        `guest_id=${upgraded}; store_id=${s.storeId}; organization_id=${s.organizationId}`,
      );
      expect(signInResponse.status).toBe(200);
      const account = (await signInResponse.json()).user._id;

      const cookie = `user_id=${account}; guest_id=${upgraded}; store_id=${s.storeId}`;
      for (const merge of mergeRequests(s, cookie, s.victim)) {
        const response = await merge.router.fetch(merge.request, envFor(s.t));
        expect({ merge: merge.name, status: response.status }).toEqual({
          merge: merge.name,
          status: 200,
        });
      }

      expect(await ownership(s)).toEqual({
        analytics: String(account),
        bag: String(account),
        order: String(account),
        savedBag: String(account),
      });
    });
  });

  it("does NOT upgrade a legacy cookie at /auth/verify or at a merge", async () => {
    await withOrigin(async () => {
      const s = await seed();

      const signInResponse = await signIn(
        s,
        "mallory@test",
        `user_id=${s.attacker}; guest_id=${s.victim}; store_id=${s.storeId}; organization_id=${s.organizationId}`,
      );
      expect(signInResponse.status).toBe(200);
      // Sign-in issues no guest cookie at all: upgrading here would hand the
      // caller a signed session on any id they typed.
      expect(guestCookieFromResponse(signInResponse)).toBeUndefined();

      const merge = mergeRequests(
        s,
        `user_id=${s.attacker}; guest_id=${s.victim}; store_id=${s.storeId}`,
        s.victim,
      )[0];
      const mergeResponse = await bagRoutes.fetch(merge.request, envFor(s.t));
      expect(mergeResponse.status).toBe(403);
      expect(guestCookieFromResponse(mergeResponse)).toBeUndefined();
    });
  });

  it("fails closed with no signing secret, while anonymous browse still works", async () => {
    await withOrigin(
      async () => {
        const s = await seed();

        // Anonymous catalog browse: the store still comes back.
        const browse = await storefrontRoutes.fetch(
          getRequest("/?storeName=store&asNewUser=true"),
          envFor(s.t),
        );
        expect(browse.status).toBe(200);
        expect((await browse.json())?.name).toBe("store");
        // ...but no guest session is issued.
        expect(guestCookieFromResponse(browse)).toBeUndefined();

        // The guest bootstrap says so rather than handing out a dud session.
        const guestBootstrap = await guestRoutes.fetch(
          getRequest("/", `guest_id=${s.victim}; store_id=${s.storeId}`),
          envFor(s.t),
        );
        expect(guestBootstrap.status).toBe(503);

        // And a cookie signed with the (now absent) secret authorizes nothing.
        const cookie = `user_id=${s.attacker}; ${signedGuest(s.victim)}; store_id=${s.storeId}`;
        for (const merge of mergeRequests(s, cookie, s.victim)) {
          const response = await merge.router.fetch(merge.request, envFor(s.t));
          expect({ merge: merge.name, status: response.status }).toEqual({
            merge: merge.name,
            status: 403,
          });
        }
      },
      { secret: "" },
    );
  });

  /**
   * A second sign-in on the same guest session must not re-point a grant the
   * first shopper is still working through: that stranded their remaining
   * merges at 403 halfway down the list.
   */
  it("does not re-point a LIVE, partly consumed grant to a second account", async () => {
    await withOrigin(async () => {
      const s = await seed();

      const guestCookie = `${signedGuest(s.victim)}; store_id=${s.storeId}; organization_id=${s.organizationId}`;
      const first = await signIn(s, "first@test", guestCookie);
      const firstAccount = (await first.json()).user._id;

      // One merge done, four still to go.
      const firstCookie = `user_id=${firstAccount}; ${signedGuest(s.victim)}; store_id=${s.storeId}`;
      const [bagMerge, ...rest] = mergeRequests(s, firstCookie, s.victim);
      expect((await bagRoutes.fetch(bagMerge.request, envFor(s.t))).status).toBe(
        200,
      );

      // A second account signs in on the same guest session, mid-sequence.
      const second = await signIn(
        s,
        "second@test",
        `user_id=${s.attacker}; ${signedGuest(s.victim)}; store_id=${s.storeId}; organization_id=${s.organizationId}`,
      );
      expect(second.status).toBe(200);

      // The grant still belongs to the first shopper...
      const guest = await s.t.run((ctx) => ctx.db.get("guest", s.victim));
      expect(String(guest?.mergeGrantedToStoreFrontUserId)).toBe(
        String(firstAccount),
      );
      expect(guest?.mergeGrantConsumedBy).toContain("bag");

      // ...whose remaining merges still complete.
      for (const merge of rest) {
        const response = await merge.router.fetch(merge.request, envFor(s.t));
        expect({ merge: merge.name, status: response.status }).toEqual({
          merge: merge.name,
          status: 200,
        });
      }
      expect(await ownership(s)).toEqual({
        analytics: String(firstAccount),
        bag: String(firstAccount),
        order: String(firstAccount),
        savedBag: String(firstAccount),
      });
    });
  });

  it("re-grants normally for the SAME account and after the grant is spent", async () => {
    await withOrigin(async () => {
      const s = await seed();

      const guestCookie = `${signedGuest(s.victim)}; store_id=${s.storeId}; organization_id=${s.organizationId}`;
      const first = await signIn(s, "again@test", guestCookie);
      const account = (await first.json()).user._id;

      const cookie = `user_id=${account}; ${signedGuest(s.victim)}; store_id=${s.storeId}`;
      const [bagMerge] = mergeRequests(s, cookie, s.victim);
      expect((await bagRoutes.fetch(bagMerge.request, envFor(s.t))).status).toBe(
        200,
      );

      // Signing in again as the same shopper refreshes their own grant, so the
      // second visit's merges are not stranded by the first visit's.
      const again = await signIn(s, "again@test", guestCookie, "654321");
      expect(again.status).toBe(200);
      const guest = await s.t.run((ctx) => ctx.db.get("guest", s.victim));
      expect(guest?.mergeGrantConsumedBy).toEqual([]);
      expect(String(guest?.mergeGrantedToStoreFrontUserId)).toBe(
        String(account),
      );
    });
  });
});

/**
 * The guest MARKER as the other way to be handed a signed session.
 *
 * Signing the cookie closed the door on a caller who merely knows a guest id,
 * but both bootstrap routes will still RESOLVE a guest from the storefront's
 * session-recovery marker and mint a signed cookie for it. Round 4 found the
 * marker was caller-chosen, low-entropy (five base-36 characters from
 * `Math.random()`), unscoped by store, and — worst — optional: no marker at all
 * matched the marker-less rows the `by_marker` index files under `undefined`.
 * Every one of those handed a stranger's session out, signed.
 *
 * These tests pin the rule: a marker resolves only when it is high-entropy,
 * and only within the store being bootstrapped. Anything else mints a FRESH
 * guest.
 */
describe("the guest marker is a session-recovery secret, or nothing", () => {
  const getRequest = (path: string, cookie?: string) =>
    new Request(`https://api.test${path}`, {
      method: "GET",
      headers: new Headers({
        Origin: ALLOWED_ORIGIN,
        ...(cookie ? { Cookie: cookie } : {}),
      }),
    });

  /** The guest id a bootstrap response's SIGNED cookie names. */
  const issuedGuestId = (response: Response) =>
    verifyStorefrontCookieValue(
      GUEST_COOKIE_NAME,
      guestCookieFromResponse(response),
      COOKIE_SECRET,
    );

  const RECOVERABLE_MARKER = "3f9c2b7e-1d4a-4c8e-9b6f-2a7d5e8c1f03";

  it("does NOT hand out an existing marker-less guest when the bootstrap sends no marker", async () => {
    await withOrigin(async () => {
      const s = await seed();
      // The oldest marker-less row in the store — what `by_marker` answered
      // for `undefined` under the previous code.
      const markerless = await s.t.run((ctx) =>
        ctx.db.insert("guest", { organizationId: s.organizationId, storeId: s.storeId }),
      );

      const storefront = await storefrontRoutes.fetch(
        getRequest("/?storeName=store&asNewUser=true"),
        envFor(s.t),
      );
      expect(storefront.status).toBe(200);
      const fromStorefront = issuedGuestId(storefront);
      expect(fromStorefront).toBeDefined();
      expect(fromStorefront).not.toBe(String(markerless));
      expect(fromStorefront).not.toBe(String(s.victim));

      // Same rule on the recovery path: a garbage cookie and no marker mints
      // a NEW guest rather than resolving to anybody's row.
      const guests = await guestRoutes.fetch(
        getRequest(
          "/",
          `guest_id=garbage; store_id=${s.storeId}; organization_id=${s.organizationId}`,
        ),
        envFor(s.t),
      );
      expect(guests.status).toBe(200);
      const fromGuests = issuedGuestId(guests);
      expect(fromGuests).toBeDefined();
      expect(fromGuests).not.toBe(String(markerless));
      expect(fromGuests).not.toBe(String(s.victim));
      expect(fromGuests).not.toBe(fromStorefront);
      const minted = await s.t.run((ctx) =>
        ctx.db.get("guest", fromGuests as Id<"guest">),
      );
      expect(String(minted?.storeId)).toBe(String(s.storeId));
      expect(minted?.marker).toBeUndefined();
    });
  });

  it("does not resolve a low-entropy marker, and does not store one on the fresh guest", async () => {
    await withOrigin(async () => {
      const s = await seed();
      // The victim's marker is exactly the shape older storefront builds sent.
      for (const path of [
        "/?storeName=store&asNewUser=true&marker=victim",
        "/?storeName=store&asNewUser=true&marker=",
      ]) {
        const response = await storefrontRoutes.fetch(getRequest(path), envFor(s.t));
        expect({ path, status: response.status }).toEqual({ path, status: 200 });
        const issued = issuedGuestId(response);
        expect({ path, issued }).not.toEqual({ path, issued: String(s.victim) });
        const row = await s.t.run((ctx) => ctx.db.get("guest", issued as Id<"guest">));
        expect({ path, marker: row?.marker }).toEqual({ path, marker: undefined });
      }
    });
  });

  it("recovers a session from a high-entropy marker in THIS store, and only this store", async () => {
    await withOrigin(async () => {
      const s = await seed();
      // Rows hold the marker's DIGEST, exactly as `guest.create` writes it.
      const { mine, foreign } = await s.t.run(async (ctx) => ({
        mine: await ctx.db.insert("guest", {
          marker: await hashGuestMarker(RECOVERABLE_MARKER),
          organizationId: s.organizationId,
          storeId: s.storeId,
        }),
        // The SAME marker in another store: a marker is a per-browser secret,
        // not a global handle, and must never resolve across stores.
        foreign: await ctx.db.insert("guest", {
          marker: await hashGuestMarker(`${RECOVERABLE_MARKER}-other`),
          organizationId: s.organizationId,
          storeId: s.otherStoreId,
        }),
      }));

      // Positive control: the storefront's own recovery still works.
      const recovered = await storefrontRoutes.fetch(
        getRequest(`/?storeName=store&asNewUser=true&marker=${RECOVERABLE_MARKER}`),
        envFor(s.t),
      );
      expect(issuedGuestId(recovered)).toBe(String(mine));

      const recoveredViaGuests = await guestRoutes.fetch(
        getRequest(
          `/?marker=${RECOVERABLE_MARKER}`,
          `guest_id=garbage; store_id=${s.storeId}; organization_id=${s.organizationId}`,
        ),
        envFor(s.t),
      );
      expect(issuedGuestId(recoveredViaGuests)).toBe(String(mine));

      // Cross-store: the other store's marker mints a fresh guest in THIS store.
      const crossStore = await storefrontRoutes.fetch(
        getRequest(`/?storeName=store&asNewUser=true&marker=${RECOVERABLE_MARKER}-other`),
        envFor(s.t),
      );
      const issued = issuedGuestId(crossStore);
      expect(issued).toBeDefined();
      expect(issued).not.toBe(String(foreign));
      const row = await s.t.run((ctx) => ctx.db.get("guest", issued as Id<"guest">));
      expect(String(row?.storeId)).toBe(String(s.storeId));

      const crossStoreViaGuests = await guestRoutes.fetch(
        getRequest(
          `/?marker=${RECOVERABLE_MARKER}-other`,
          `guest_id=garbage; store_id=${s.storeId}; organization_id=${s.organizationId}`,
        ),
        envFor(s.t),
      );
      expect(issuedGuestId(crossStoreViaGuests)).not.toBe(String(foreign));
    });
  });

  /**
   * THE ROUND-4 ATTACK, end to end: bootstrap cookie-less with the victim's
   * (guessed or leaked) marker, take the signed cookie, sign in as yourself,
   * run the merges. It has to fail at the first step — the cookie issued is
   * for a fresh guest, so the grant lands there and the victim's rows stay put.
   */
  it("cannot turn a victim's marker into a signed session and then merge their rows", async () => {
    await withOrigin(async () => {
      const s = await seed();
      const before = await ownership(s);

      const bootstrap = await storefrontRoutes.fetch(
        getRequest("/?storeName=store&asNewUser=true&marker=victim"),
        envFor(s.t),
      );
      const issuedCookie = guestCookieFromResponse(bootstrap);
      const issued = verifyStorefrontCookieValue(
        GUEST_COOKIE_NAME,
        issuedCookie,
        COOKIE_SECRET,
      );
      expect(issued).toBeDefined();
      expect(issued).not.toBe(String(s.victim));

      const signInResponse = await signIn(
        s,
        "mallory@test",
        `guest_id=${issuedCookie}; store_id=${s.storeId}; organization_id=${s.organizationId}`,
      );
      expect(signInResponse.status).toBe(200);
      const account = (await signInResponse.json()).user._id;

      // The grant was minted on the FRESH guest, never on the victim's row.
      const victim = await s.t.run((ctx) => ctx.db.get("guest", s.victim));
      expect(victim?.mergeGrantedToStoreFrontUserId ?? null).toBeNull();

      const cookie = `user_id=${account}; guest_id=${issuedCookie}; store_id=${s.storeId}`;
      for (const merge of mergeRequests(s, cookie, s.victim)) {
        const response = await merge.router.fetch(merge.request, envFor(s.t));
        expect({ merge: merge.name, status: response.status }).toEqual({
          merge: merge.name,
          status: 403,
        });
      }
      expect(await ownership(s)).toEqual(before);
    });
  });
  /**
   * The marker at REST. Round 5 made the marker a session secret, and a
   * secret stored in plaintext on a row that operator surfaces read back whole
   * (`storeFront/guest:getAll`, `storeFront/users:getByIds`, and the public
   * `GET /guests` itself) is a secret disclosed to everyone who can read a
   * guest document. So the row holds only its digest, and nothing a document
   * contains is a value the bootstrap routes will resolve.
   */
  it("persists only a digest, and a marker lifted from a guest document does not resolve", async () => {
    await withOrigin(async () => {
      const s = await seed();

      // Mint through the real route, as the storefront does.
      const minted = await storefrontRoutes.fetch(
        getRequest(`/?storeName=store&asNewUser=true&marker=${RECOVERABLE_MARKER}`),
        envFor(s.t),
      );
      const mine = issuedGuestId(minted) as Id<"guest">;
      expect(mine).toBeDefined();

      // What every reader of the guest document sees, via the public
      // recovery route itself and via a raw read of the row.
      const document = await (
        await guestRoutes.fetch(
          getRequest("/", `${signedGuest(mine)}; store_id=${s.storeId}`),
          envFor(s.t),
        )
      ).json();
      const row = await s.t.run((ctx) => ctx.db.get("guest", mine));
      expect(String(document._id)).toBe(String(mine));
      expect(row?.marker).toBe(await hashGuestMarker(RECOVERABLE_MARKER));
      expect(document.marker).toBe(row?.marker);
      expect(JSON.stringify(document)).not.toContain(RECOVERABLE_MARKER);

      // The digest is itself a well-formed marker (64 hex chars); presenting
      // it must NOT resolve the row it was lifted from, on either route.
      const stolen = document.marker as string;
      const viaStorefront = await storefrontRoutes.fetch(
        getRequest(`/?storeName=store&asNewUser=true&marker=${stolen}`),
        envFor(s.t),
      );
      const viaGuests = await guestRoutes.fetch(
        getRequest(
          `/?marker=${stolen}`,
          `guest_id=garbage; store_id=${s.storeId}; organization_id=${s.organizationId}`,
        ),
        envFor(s.t),
      );
      for (const issued of [issuedGuestId(viaStorefront), issuedGuestId(viaGuests)]) {
        expect(issued).toBeDefined();
        expect(issued).not.toBe(String(mine));
      }

      // Positive control: the browser that holds the RAW marker still recovers.
      const recovered = await storefrontRoutes.fetch(
        getRequest(`/?storeName=store&asNewUser=true&marker=${RECOVERABLE_MARKER}`),
        envFor(s.t),
      );
      expect(issuedGuestId(recovered)).toBe(String(mine));
    });
  });

  it("does not resolve the same marker held by an OLDER row in another store", async () => {
    await withOrigin(async () => {
      const s = await seed();
      // The foreign row is inserted FIRST, so a lookup that forgot the store
      // (`by_marker … .first()`) would answer it.
      const foreign = await s.t.run(async (ctx) =>
        ctx.db.insert("guest", {
          marker: await hashGuestMarker(RECOVERABLE_MARKER),
          organizationId: s.organizationId,
          storeId: s.otherStoreId,
        }),
      );

      const first = await storefrontRoutes.fetch(
        getRequest(`/?storeName=store&asNewUser=true&marker=${RECOVERABLE_MARKER}`),
        envFor(s.t),
      );
      const mine = issuedGuestId(first);
      expect(mine).toBeDefined();
      expect(mine).not.toBe(String(foreign));
      const row = await s.t.run((ctx) => ctx.db.get("guest", mine as Id<"guest">));
      expect(String(row?.storeId)).toBe(String(s.storeId));

      // And the row minted for THIS store is the one this store recovers,
      // even though the foreign row with the same digest is older.
      const again = await storefrontRoutes.fetch(
        getRequest(`/?storeName=store&asNewUser=true&marker=${RECOVERABLE_MARKER}`),
        envFor(s.t),
      );
      expect(issuedGuestId(again)).toBe(mine);
      const viaGuests = await guestRoutes.fetch(
        getRequest(
          `/?marker=${RECOVERABLE_MARKER}`,
          `guest_id=garbage; store_id=${s.storeId}; organization_id=${s.organizationId}`,
        ),
        envFor(s.t),
      );
      expect(issuedGuestId(viaGuests)).toBe(mine);
    });
  });
  /**
   * The write half of the same rule, at the callee. A route is not the only
   * thing that can hand `guest.create` a marker, so the gate, the digest and
   * the per-(store, marker) uniqueness live in the mutation itself.
   */
  it("`guest.create` refuses to persist an unrecoverable marker, stores a digest, and never mints a second row for the same marker in a store", async () => {
    await withOrigin(async () => {
      const s = await seed();
      const create = (marker: string | undefined, storeId = s.storeId) =>
        s.t.mutation(internal.storeFront.guest.create, {
          creationOrigin: "test",
          marker,
          organizationId: s.organizationId,
          storeId,
        });

      // A marker `getByMarker` would never resolve is not stored at all.
      for (const marker of ["victim", "", undefined]) {
        const row = await create(marker);
        expect({ marker, stored: row?.marker }).toEqual({ marker, stored: undefined });
      }

      // A recoverable one is stored as its digest, once per store …
      const first = await create(RECOVERABLE_MARKER);
      expect(first?.marker).toBe(await hashGuestMarker(RECOVERABLE_MARKER));
      const second = await create(RECOVERABLE_MARKER);
      expect(String(second?._id)).toBe(String(first?._id));
      const rows = await s.t.run((ctx) =>
        ctx.db
          .query("guest")
          .withIndex("by_marker", (q) => q.eq("marker", first?.marker))
          .take(10),
      );
      expect(rows).toHaveLength(1);

      // … and a different store gets its own row.
      const foreign = await create(RECOVERABLE_MARKER, s.otherStoreId);
      expect(String(foreign?._id)).not.toBe(String(first?._id));
      expect(String(foreign?.storeId)).toBe(String(s.otherStoreId));
    });
  });
});
