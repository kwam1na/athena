/// <reference types="vite/client" />

/**
 * U10 admission contract for `convex/http/domains/customerChannel/**`.
 *
 * Four layers, matching the four things this migration had to establish:
 *
 * 1. The definitions are valid and say the right thing: customer writes are
 *    claim-only AND origin-fenced, browse reads stay anonymous, the webhook is
 *    public but signed, and the shared demo reaches none of it.
 * 2. The Paystack verifier fails closed and HMACs the raw body.
 * 3. End to end through the EXPORTED Hono routers, driven by the real
 *    composition-root admission entry points: a valid claim behaves as before,
 *    and a cookieless / foreign-origin / unknown-claim / storeless-guest /
 *    bad-signature request is denied without ever reaching the admission
 *    mutation or the handler.
 * 4. Identity comes from the admitted actor: a forged id in the request body
 *    changes the TARGET a callee is asked about, never the `owner` it is
 *    checked against.
 */

import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";

import { internal } from "../../../../_generated/api";
import {
  admitOperationWithCtx,
  admitReadOperationWithCtx,
} from "../../../../platform/operationAdmission";
import {
  validateOperationDefinition,
} from "../../../../operationAdmission/definitions";
import {
  validateReadOperationDefinition,
} from "../../../../operationAdmission/readDefinitions";
import {
  PAYSTACK_SECRET_ENV,
  PAYSTACK_SIGNATURE_HEADER,
  PAYSTACK_SIGNATURE_VERIFIER,
  createPaystackSignatureVerifier,
} from "../../../../operationAdmission/ingressVerification";
import { U10_HTTP_CUSTOMER_OPERATION_DEFINITIONS } from "../../../../operationAdmission/domains/u10_httpCustomer_definitions";
import { U10_HTTP_CUSTOMER_READ_OPERATION_DEFINITIONS } from "../../../../operationAdmission/domains/u10_httpCustomer_readDefinitions";

import {
  GUEST_COOKIE_NAME,
  STOREFRONT_COOKIE_SECRET_ENV,
  signStorefrontCookieValue,
} from "../../../../platform/storefrontCookieSignature";

import { bagRoutes } from "./bag";
import { meRoutes } from "./me";
import { onlineOrderRoutes } from "./onlineOrder";
import { paystackRoutes } from "./paystack";
import { rewardsRoutes } from "./rewards";
import { reviewRoutes } from "./reviews";
import { savedBagRoutes } from "./savedBag";
import { userRoutes } from "./user";

const ALLOWED_ORIGIN = "https://shop.test";
const ORIGIN_ENV = "ATHENA_STOREFRONT_ALLOWED_ORIGINS";

/**
 * A `guest_id` cookie is only a claim when it carries the server's signature,
 * so every guest cookie in this file is minted the way the two bootstrap
 * routes mint it.
 */
const COOKIE_SECRET = "test-storefront-cookie-secret";
const guestCookie = (guestId: string) =>
  `guest_id=${signStorefrontCookieValue(GUEST_COOKIE_NAME, guestId, COOKIE_SECRET)}`;

const ADMIT_WRITE = getFunctionName(
  internal.platform.admissionEntrypoints.admitOperation,
);
const ADMIT_READ = getFunctionName(
  internal.platform.admissionEntrypoints.admitReadOperation,
);

/* --------------------------------------------------------- 1. definitions */

describe("U10 route definitions", () => {
  it("covers 26 write routes and 29 read routes and validates", () => {
    expect(U10_HTTP_CUSTOMER_OPERATION_DEFINITIONS).toHaveLength(26);
    expect(U10_HTTP_CUSTOMER_READ_OPERATION_DEFINITIONS).toHaveLength(29);

    for (const definition of U10_HTTP_CUSTOMER_OPERATION_DEFINITIONS) {
      expect({
        operationId: definition.operationId,
        errors: validateOperationDefinition(definition),
      }).toEqual({ operationId: definition.operationId, errors: [] });
      expect(definition.kind).toBe("http");
      expect(definition.route).toBeDefined();
    }

    for (const definition of U10_HTTP_CUSTOMER_READ_OPERATION_DEFINITIONS) {
      expect({
        operationId: definition.operationId,
        errors: validateReadOperationDefinition(definition),
      }).toEqual({ operationId: definition.operationId, errors: [] });
      expect(definition.kind).toBe("http_read");
      expect(definition.route).toBeDefined();
    }
  });

  it("makes every customer write claim-only and origin-fenced", () => {
    const customerWrites = U10_HTTP_CUSTOMER_OPERATION_DEFINITIONS.filter(
      (definition) => definition.actors.storefrontCustomer === "admit",
    );

    // 26 write routes, of which exactly 3 are pre-claim public ingress.
    expect(customerWrites.length).toBe(23);
    for (const definition of customerWrites) {
      // Mutually exclusive by rail rule: a cookieless request to a customer
      // write route is a terminal denial, never an anonymous admission.
      expect(definition.actors.public).toBe("deny");
      expect(definition.ingressVerification).toEqual({
        kind: "origin_allowlist",
      });
      expect(definition.scope.kind).toBe("store");
    }
  });

  it("declares a verifier on every public write and signs only the webhook", () => {
    const publicWrites = U10_HTTP_CUSTOMER_OPERATION_DEFINITIONS.filter(
      (definition) => definition.actors.public === "admit",
    );

    expect(publicWrites.map((definition) => definition.operationId).sort()).toEqual([
      "http.customerChannel.guest.create",
      "http.customerChannel.paystack.webhook",
      "http.customerChannel.storefront.inventoryBatch",
    ]);

    for (const definition of publicWrites) {
      expect(definition.ingressVerification).toBeDefined();
      expect(definition.actors.storefrontCustomer).toBe("deny");
    }

    const webhook = publicWrites.find(
      (definition) =>
        definition.operationId === "http.customerChannel.paystack.webhook",
    );
    expect(webhook?.ingressVerification).toEqual({
      kind: "signature",
      verifier: PAYSTACK_SIGNATURE_VERIFIER,
    });
  });

  it("keeps customer-scoped reads claim-only and browse reads anonymous", () => {
    const claimOnly = U10_HTTP_CUSTOMER_READ_OPERATION_DEFINITIONS.filter(
      (definition) => definition.actors.storefrontCustomer === "admit",
    );
    const browse = U10_HTTP_CUSTOMER_READ_OPERATION_DEFINITIONS.filter(
      (definition) => definition.actors.public === "admit",
    );

    for (const definition of claimOnly) {
      expect(definition.actors.public).toBe("deny");
      expect(definition.scope.kind).toBe("store");
    }
    for (const definition of browse) {
      expect(definition.actors.storefrontCustomer).toBe("deny");
    }
    // Claim-only and browse partition the read surface: no read is both.
    expect(claimOnly.length + browse.length).toBe(
      U10_HTTP_CUSTOMER_READ_OPERATION_DEFINITIONS.length,
    );
  });

  it("never admits the shared demo anywhere in the customer channel", () => {
    for (const definition of [
      ...U10_HTTP_CUSTOMER_OPERATION_DEFINITIONS,
      ...U10_HTTP_CUSTOMER_READ_OPERATION_DEFINITIONS,
    ]) {
      expect({
        operationId: definition.operationId,
        sharedDemo: definition.actors.sharedDemo,
      }).toEqual({ operationId: definition.operationId, sharedDemo: "deny" });
    }
  });
});

/* --------------------------------------------------- 2. paystack verifier */

describe("paystack signature verification", () => {
  const body = '{"event":"charge.success"}';

  const sign = async (secret: string, payload: string) => {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"],
    );
    const digest = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payload),
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  };

  const input = (rawBody: string, signature?: string) => ({
    headers: new Headers(
      signature ? { [PAYSTACK_SIGNATURE_HEADER]: signature } : {},
    ),
    rawBody,
    request: new Request("https://api.test/webhooks/paystack"),
  });

  it("accepts an HMAC-SHA512 over exactly the raw body", async () => {
    const verify = createPaystackSignatureVerifier({
      [PAYSTACK_SECRET_ENV]: "sk_test",
    });

    await expect(
      verify(input(body, await sign("sk_test", body))),
    ).resolves.toBe(true);
  });

  it("fails closed with no configured secret, even for a valid digest", async () => {
    const signature = await sign("sk_test", body);

    await expect(
      createPaystackSignatureVerifier({})(input(body, signature)),
    ).resolves.toBe(false);
    await expect(
      createPaystackSignatureVerifier({ [PAYSTACK_SECRET_ENV]: "" })(
        input(body, signature),
      ),
    ).resolves.toBe(false);
  });

  it("rejects a missing, empty, wrong-key and body-tampered signature", async () => {
    const verify = createPaystackSignatureVerifier({
      [PAYSTACK_SECRET_ENV]: "sk_test",
    });

    await expect(verify(input(body))).resolves.toBe(false);
    await expect(verify(input(body, ""))).resolves.toBe(false);
    await expect(
      verify(input(body, await sign("sk_other", body))),
    ).resolves.toBe(false);
    // The digest is over the raw body, so any edit to the payload invalidates
    // it — signature and handler input can never drift apart.
    await expect(
      verify(input('{"event":"charge.failed"}', await sign("sk_test", body))),
    ).resolves.toBe(false);
  });
});

/* ------------------------------------------------------- 3/4. route level */

type Rows = Record<string, Record<string, any>>;

/**
 * Drives a real exported Hono router against the REAL admission entry points.
 *
 * `runMutation`/`runQuery` recognise the two composition-root entry points and
 * run the actual rail (definitions, adapter chain, claim resolution, scope)
 * against a small in-memory `db`; every other call is recorded so a test can
 * assert exactly which arguments a route forwarded. `admissionWrites` counts
 * invocations of the write entry point, which is where an admission row would
 * be recorded — "zero admission rows" is literally "this stayed at 0".
 */
function harness(rows: Rows = {}, results: Record<string, unknown> = {}) {
  const ctx = {
    auth: { getUserIdentity: async () => null },
    db: {
      get: async (table: string, id: string) => rows[table]?.[id] ?? null,
    },
  } as any;

  const calls: { name: string; args: any }[] = [];
  let admissionWrites = 0;

  const dispatch = async (ref: any, args: any) => {
    const name = getFunctionName(ref);
    if (name === ADMIT_WRITE) {
      admissionWrites += 1;
      return await admitOperationWithCtx(ctx, args);
    }
    if (name === ADMIT_READ) {
      return await admitReadOperationWithCtx(ctx, args);
    }
    calls.push({ name, args });
    return results[name] ?? null;
  };

  return {
    calls,
    admissionWrites: () => admissionWrites,
    env: {
      runMutation: dispatch,
      runQuery: dispatch,
      runAction: dispatch,
    },
    called: (fn: any) =>
      calls.find((call) => call.name === getFunctionName(fn)),
  };
}

const STORE_ROWS: Rows = {
  storeFrontUser: {
    "user-A": { _id: "user-A", storeId: "store-1" },
    "user-B": { _id: "user-B", storeId: "store-2" },
  },
  guest: {
    "guest-A": { _id: "guest-A", storeId: "store-1" },
    "guest-storeless": { _id: "guest-storeless" },
  },
};

function request(
  path: string,
  options: {
    body?: unknown;
    cookie?: string;
    headers?: Record<string, string>;
    method?: string;
    origin?: string | null;
  } = {},
) {
  const headers = new Headers(options.headers ?? {});
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (typeof options.origin === "string") {
    headers.set("Origin", options.origin);
  }
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  return new Request(`https://api.test${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
}

const withOrigin = async (run: () => Promise<void>) => {
  vi.stubEnv(ORIGIN_ENV, ALLOWED_ORIGIN);
  vi.stubEnv(STOREFRONT_COOKIE_SECRET_ENV, COOKIE_SECRET);
  try {
    await run();
  } finally {
    vi.unstubAllEnvs();
  }
};

describe("customer write routes", () => {
  it("admits a valid claim and forwards the ADMITTED owner, not the body's ids", async () => {
    await withOrigin(async () => {
      const test = harness(STORE_ROWS, {
        [getFunctionName(internal.storeFront.bagItem.addItemToBag)]: {
          _id: "item-1",
        },
      });

      const response = await bagRoutes.fetch(
        request("/bag-1/items", {
          method: "POST",
          cookie: "user_id=user-A; store_id=store-1",
          origin: ALLOWED_ORIGIN,
          body: {
            productId: "product-1",
            productSkuId: "sku-1",
            productSku: "SKU-1",
            quantity: 2,
            // Forged: the route must ignore this entirely.
            storeFrontUserId: "user-B",
            owner: { storeFrontUserId: "user-B", storeId: "store-2" },
          },
        }),
        test.env as never,
      );

      expect(response.status).toBe(200);
      expect(test.admissionWrites()).toBe(1);

      const call = test.called(internal.storeFront.bagItem.addItemToBag);
      expect(call?.args.owner).toEqual({
        storeFrontUserId: "user-A",
        storeId: "store-1",
      });
      expect(call?.args.storeFrontUserId).toBe("user-A");
      // `bagId` stays caller-supplied — it is the target the callee then checks
      // against `owner`, which is what makes the forged-id case a denial in the
      // callee rather than a silent cross-customer write.
      expect(call?.args.bagId).toBe("bag-1");
      expect(call?.args.quantity).toBe(2);
    });
  });

  it("denies a cookieless customer write with zero admission rows and no callee", async () => {
    await withOrigin(async () => {
      const test = harness(STORE_ROWS);

      const response = await bagRoutes.fetch(
        request("/bag-1/items", {
          method: "POST",
          origin: ALLOWED_ORIGIN,
          body: { productId: "product-1", quantity: 1 },
        }),
        test.env as never,
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(test.calls).toEqual([]);
    });
  });

  it("denies a foreign origin before admission runs at all", async () => {
    await withOrigin(async () => {
      const test = harness(STORE_ROWS);

      const response = await bagRoutes.fetch(
        request("/bag-1/items", {
          method: "POST",
          cookie: "user_id=user-A; store_id=store-1",
          origin: "https://evil.test",
          body: { productId: "product-1", quantity: 1 },
        }),
        test.env as never,
      );

      expect(response.status).toBe(403);
      expect(test.admissionWrites()).toBe(0);
      expect(test.calls).toEqual([]);
    });
  });

  it("denies an absent origin on a customer write", async () => {
    await withOrigin(async () => {
      const test = harness(STORE_ROWS);

      const response = await bagRoutes.fetch(
        request("/bag-1/items", {
          method: "POST",
          cookie: "user_id=user-A; store_id=store-1",
          body: { productId: "product-1", quantity: 1 },
        }),
        test.env as never,
      );

      expect(response.status).toBe(403);
      expect(test.admissionWrites()).toBe(0);
    });
  });

  it("fails closed when no storefront origin allowlist is configured", async () => {
    vi.stubEnv(ORIGIN_ENV, "");
    const test = harness(STORE_ROWS);

    const response = await bagRoutes.fetch(
      request("/bag-1/items", {
        method: "POST",
        cookie: "user_id=user-A; store_id=store-1",
        origin: ALLOWED_ORIGIN,
        body: { productId: "product-1", quantity: 1 },
      }),
      test.env as never,
    );

    expect(response.status).toBe(403);
    expect(test.admissionWrites()).toBe(0);
    vi.unstubAllEnvs();
  });

  it("denies an unknown claim, a foreign-store cross-check and a storeless guest", async () => {
    await withOrigin(async () => {
      const cases = [
        // Unknown id: no row to clamp to.
        "user_id=user-ghost; store_id=store-1",
        // The claim row says store-1, the cookie claims store-2.
        "user_id=user-A; store_id=store-2",
        // A guest with no store can never be clamped, so it is never admitted.
        `${guestCookie("guest-storeless")}; store_id=store-1`,
      ];

      for (const cookie of cases) {
        const test = harness(STORE_ROWS);
        const response = await bagRoutes.fetch(
          request("/bag-1/items", {
            method: "POST",
            cookie,
            origin: ALLOWED_ORIGIN,
            body: { productId: "product-1", quantity: 1 },
          }),
          test.env as never,
        );

        expect({ cookie, status: response.status >= 400 }).toEqual({
          cookie,
          status: true,
        });
        expect({ cookie, calls: test.calls }).toEqual({ cookie, calls: [] });
      }
    });
  });

  it("re-owns orders onto the admitted account, never a body-supplied one", async () => {
    await withOrigin(async () => {
      const test = harness(STORE_ROWS);

      await onlineOrderRoutes.fetch(
        request("/owner", {
          method: "POST",
          cookie: `user_id=user-A; ${guestCookie("guest-A")}; store_id=store-1`,
          origin: ALLOWED_ORIGIN,
          body: { currentOwnerId: "guest-A", newOwnerId: "user-B" },
        }),
        test.env as never,
      );

      const call = test.called(
        internal.storeFront.onlineOrder.updateOwnerInternal,
      );
      // `newOwner` is gone from the call surface entirely, and NO merge
      // evidence travels either: the guest cookie is not forwarded, because a
      // cookie proves nothing. The callee authorizes on the server-issued
      // grant written onto the guest row at sign-in.
      expect(call?.args).toEqual({
        currentOwner: "guest-A",
        owner: { storeFrontUserId: "user-A", storeId: "store-1" },
      });
    });
  });

  /**
   * The signed-in actor still wins for IDENTITY when both cookies are present.
   * Carrying the guest id through must not turn a signed-in shopper into a
   * guest for any other route.
   */
  it("keeps the account as the actor when both cookies are present", async () => {
    await withOrigin(async () => {
      const test = harness(STORE_ROWS);

      await bagRoutes.fetch(
        request("/bag-1/items", {
          method: "POST",
          cookie: `user_id=user-A; ${guestCookie("guest-A")}; store_id=store-1`,
          origin: ALLOWED_ORIGIN,
          body: { productId: "product-1", quantity: 1 },
        }),
        test.env as never,
      );

      const call = test.called(internal.storeFront.bagItem.addItemToBag);
      expect(call?.args.owner).toEqual({
        storeFrontUserId: "user-A",
        storeId: "store-1",
      });
    });
  });

  it("forwards no merge evidence on a bag merge, only the target and the owner", async () => {
    await withOrigin(async () => {
      const test = harness(STORE_ROWS);

      await bagRoutes.fetch(
        request("/bag-1/owner", {
          method: "POST",
          cookie: `user_id=user-A; ${guestCookie("guest-A")}; store_id=store-1`,
          origin: ALLOWED_ORIGIN,
          // A forged guest id in the body. It stays the TARGET; the callee
          // refuses it because that row carries no server-issued grant.
          body: { currentOwnerId: "guest-stranger", newOwnerId: "user-B" },
        }),
        test.env as never,
      );

      const call = test.called(internal.storeFront.bag.updateOwner);
      expect(call?.args).toEqual({
        currentOwner: "guest-stranger",
        owner: { storeFrontUserId: "user-A", storeId: "store-1" },
      });
    });
  });

  it("answers 400, not 500, for a malformed merge body", async () => {
    await withOrigin(async () => {
      for (const [name, router, path] of [
        ["bag", bagRoutes, "/bag-1/owner"],
        ["savedBag", savedBagRoutes, "/saved-1/owner"],
        // `onlineOrder` and `rewards` imported `tryParseIngressJson` but never
        // called it, so a truncated body on these two routes escaped as an
        // unhandled `SyntaxError` (a 500) instead of the 400 the sibling merge
        // routes already answered.
        ["onlineOrder", onlineOrderRoutes, "/owner"],
        ["rewards", rewardsRoutes, "/award-guest-orders"],
      ] as const) {
        const test = harness(STORE_ROWS);

        const response = await router.fetch(
          new Request(`https://api.test${path}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: `user_id=user-A; ${guestCookie("guest-A")}; store_id=store-1`,
              Origin: ALLOWED_ORIGIN,
            },
            body: '{"currentOwnerId":',
          }),
          test.env as never,
        );

        expect({ name, status: response.status }).toEqual({
          name,
          status: 400,
        });
        expect({ name, calls: test.calls }).toEqual({ name, calls: [] });
      }
    });
  });

  it("marks a review helpful as the admitted shopper", async () => {
    await withOrigin(async () => {
      const test = harness(STORE_ROWS);

      await reviewRoutes.fetch(
        request("/review-1/helpful", {
          method: "POST",
          cookie: `${guestCookie("guest-A")}; store_id=store-1`,
          origin: ALLOWED_ORIGIN,
          body: { userId: "user-B" },
        }),
        test.env as never,
      );

      const call = test.called(internal.storeFront.reviews.markHelpfulInternal);
      expect(call?.args).toEqual({
        reviewId: "review-1",
        owner: { guestId: "guest-A", storeId: "store-1" },
      });
    });
  });
});

describe("customer read routes", () => {
  it("resolves GET /me from the claim and records no admission row", async () => {
    const test = harness(STORE_ROWS, {
      [getFunctionName(internal.storeFront.user.getById)]: {
        _id: "user-A",
      },
    });

    const response = await meRoutes.fetch(
      request("/", { cookie: "user_id=user-A; store_id=store-1" }),
      test.env as never,
    );

    expect(response.status).toBe(200);
    // Reads run through the internal query: no write, no capture, no row.
    expect(test.admissionWrites()).toBe(0);
    expect(test.called(internal.storeFront.user.getById)?.args).toEqual({
      id: "user-A",
      owner: { storeFrontUserId: "user-A", storeId: "store-1" },
    });
  });

  it("passes a forged :userId as a target while the owner stays the claim's", async () => {
    const test = harness(STORE_ROWS);

    await userRoutes.fetch(
      request("/user-B", { cookie: "user_id=user-A; store_id=store-1" }),
      test.env as never,
    );

    const call = test.called(internal.storeFront.user.getById);
    // storeFront/user then refuses the mismatch — the route cannot launder the
    // path parameter into the identity the check is made against.
    expect(call?.args).toEqual({
      id: "user-B",
      owner: { storeFrontUserId: "user-A", storeId: "store-1" },
    });
  });

  it("denies a cookieless customer-scoped read before the callee", async () => {
    const test = harness(STORE_ROWS);

    const response = await meRoutes.fetch(request("/"), test.env as never);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(test.calls).toEqual([]);
  });

  it("admits an anonymous browse read with no admission row", async () => {
    const test = harness(STORE_ROWS, {
      [getFunctionName(internal.storeFront.reviews.getByProductIdInternal)]: [],
    });

    const response = await reviewRoutes.fetch(
      request("/product/product-1"),
      test.env as never,
    );

    expect(response.status).toBe(200);
    expect(test.admissionWrites()).toBe(0);
    expect(
      test.called(internal.storeFront.reviews.getByProductIdInternal)?.args,
    ).toEqual({ productId: "product-1" });
  });
});

describe("paystack webhook route", () => {
  const payload = { event: "charge.success", data: { metadata: {} } };

  it("rejects a bad signature with zero admission rows and no handler work", async () => {
    vi.stubEnv(PAYSTACK_SECRET_ENV, "sk_test");
    const test = harness();

    const response = await paystackRoutes.fetch(
      request("/", {
        method: "POST",
        body: payload,
        headers: { [PAYSTACK_SIGNATURE_HEADER]: "deadbeef" },
      }),
      test.env as never,
    );

    // The rail's uniform ingress-verification denial. Nothing was admitted and
    // nothing was captured, which is the property the ticket asks for.
    expect(response.status).toBe(403);
    expect(test.admissionWrites()).toBe(0);
    expect(test.calls).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("rejects an unsigned request and a request with no configured secret", async () => {
    const unsigned = harness();
    vi.stubEnv(PAYSTACK_SECRET_ENV, "sk_test");
    const unsignedResponse = await paystackRoutes.fetch(
      request("/", { method: "POST", body: payload }),
      unsigned.env as never,
    );
    expect(unsignedResponse.status).toBe(403);
    expect(unsigned.admissionWrites()).toBe(0);
    vi.unstubAllEnvs();

    vi.stubEnv(PAYSTACK_SECRET_ENV, "");
    const unconfigured = harness();
    const unconfiguredResponse = await paystackRoutes.fetch(
      request("/", {
        method: "POST",
        body: payload,
        headers: { [PAYSTACK_SIGNATURE_HEADER]: "deadbeef" },
      }),
      unconfigured.env as never,
    );
    expect(unconfiguredResponse.status).toBe(403);
    expect(unconfigured.admissionWrites()).toBe(0);
    vi.unstubAllEnvs();
  });

  it("admits and runs the handler for a correctly signed body", async () => {
    vi.stubEnv(PAYSTACK_SECRET_ENV, "sk_test");
    const raw = JSON.stringify({ event: "refund.pending", data: { id: 7 } });
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode("sk_test"),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"],
    );
    const signature = [
      ...new Uint8Array(
        await crypto.subtle.sign("HMAC", key, encoder.encode(raw)),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    const test = harness();
    const response = await paystackRoutes.fetch(
      new Request("https://api.test/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [PAYSTACK_SIGNATURE_HEADER]: signature,
        },
        body: raw,
      }),
      test.env as never,
    );

    expect(response.status).toBe(200);
    expect(test.admissionWrites()).toBe(1);
    expect(
      test.called(internal.storeFront.onlineOrder.updateInternal)?.args.update
        .status,
    ).toBe("refund-pending");
    vi.unstubAllEnvs();
  });
});

/* ------------------------------------------- 5. denial → status mapping */

/**
 * What status does a shopper actually SEE when a callee refuses them?
 *
 * The rule these routes agreed on is narrow on purpose: an ownership refusal
 * is a 403, and every other error propagates so it surfaces as the fault it
 * is. Two ways to break it were shipped and are pinned here:
 *
 *  - `storeFront/onlineOrder` raised a module-local error class whose message
 *    the route's `isCustomerOwnershipDenial` predicate never matched, so every
 *    refusal escaped the catch and rendered as a 500;
 *  - `routes/user.ts` had no catch at all on its writes (bare 500) and mapped
 *    its reads to 400 carrying the internal message.
 *
 * The 404 branch has to stay reachable too: a callee that throws on a MISSING
 * row means "not found" can never be answered.
 */
describe("ownership denials map to 403, and absence to 404", () => {
  const OWNERSHIP_DENIAL = new Error(
    "This storefront resource is not available for this shopper.",
  );

  function harnessThrowing(fn: any, error: unknown, rows: Rows = STORE_ROWS) {
    const test = harness(rows);
    const target = getFunctionName(fn);
    const wrap = (inner: any) => async (ref: any, args: any) => {
      if (getFunctionName(ref) === target) throw error;
      return inner(ref, args);
    };
    test.env.runQuery = wrap(test.env.runQuery);
    test.env.runMutation = wrap(test.env.runMutation);
    return test;
  }

  const CUSTOMER_COOKIE = "user_id=user-A; store_id=store-1";

  it("GET /orders/:orderId answers 403 for a foreign order", async () => {
    await withOrigin(async () => {
      const test = harnessThrowing(
        internal.storeFront.onlineOrder.getForCustomerInternal,
        OWNERSHIP_DENIAL,
      );

      const response = await onlineOrderRoutes.fetch(
        request("/order-1", {
          cookie: CUSTOMER_COOKIE,
          origin: ALLOWED_ORIGIN,
        }),
        test.env as never,
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Forbidden" });
    });
  });

  it("GET /orders/:orderId answers 404 for an absent order", async () => {
    await withOrigin(async () => {
      // The callee returns null rather than throwing for a row that does not
      // exist, which is the only way this branch is reachable.
      const test = harness(STORE_ROWS);

      const response = await onlineOrderRoutes.fetch(
        request("/order-missing", {
          cookie: CUSTOMER_COOKIE,
          origin: ALLOWED_ORIGIN,
        }),
        test.env as never,
      );

      expect(response.status).toBe(404);
    });
  });

  it("GET /users/:userId answers 403, not 400, for a foreign id", async () => {
    await withOrigin(async () => {
      const test = harnessThrowing(
        internal.storeFront.user.getById,
        OWNERSHIP_DENIAL,
      );

      const response = await userRoutes.fetch(
        request("/user-B", { cookie: CUSTOMER_COOKIE, origin: ALLOWED_ORIGIN }),
        test.env as never,
      );

      expect(response.status).toBe(403);
      // The internal message never reaches the caller.
      expect(await response.json()).toEqual({ error: "Forbidden" });
    });
  });

  it("PUT /users/:userId answers 403, not 500, for a foreign id", async () => {
    await withOrigin(async () => {
      const test = harnessThrowing(
        internal.storeFront.user.update,
        OWNERSHIP_DENIAL,
      );

      const response = await userRoutes.fetch(
        request("/user-B", {
          method: "PUT",
          cookie: CUSTOMER_COOKIE,
          origin: ALLOWED_ORIGIN,
          body: { firstName: "Mallory" },
        }),
        test.env as never,
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Forbidden" });
    });
  });

  it("PUT /users/me answers 403 when the callee refuses", async () => {
    await withOrigin(async () => {
      const test = harnessThrowing(
        internal.storeFront.user.update,
        OWNERSHIP_DENIAL,
      );

      const response = await userRoutes.fetch(
        request("/me", {
          method: "PUT",
          cookie: CUSTOMER_COOKIE,
          origin: ALLOWED_ORIGIN,
          body: { firstName: "Mallory" },
        }),
        test.env as never,
      );

      expect(response.status).toBe(403);
    });
  });

  it("POST /bags/:bagId/owner answers 403 for a refused merge", async () => {
    await withOrigin(async () => {
      const test = harnessThrowing(
        internal.storeFront.bag.updateOwner,
        OWNERSHIP_DENIAL,
      );

      const response = await bagRoutes.fetch(
        request("/bag-1/owner", {
          method: "POST",
          cookie: CUSTOMER_COOKIE,
          origin: ALLOWED_ORIGIN,
          body: { currentOwnerId: "guest-stranger" },
        }),
        test.env as never,
      );

      expect(response.status).toBe(403);
    });
  });

  it("does not dress a genuine fault up as a client error", async () => {
    await withOrigin(async () => {
      const test = harnessThrowing(
        internal.storeFront.user.getById,
        new Error("index missing"),
      );

      // Hono renders an uncaught error as a 500. What matters is that it is
      // NOT reported as a 4xx: a fault answered with 400/403 tells the caller
      // to stop retrying and tells monitoring nothing is wrong.
      const response = await userRoutes.fetch(
        request("/user-B", { cookie: CUSTOMER_COOKIE, origin: ALLOWED_ORIGIN }),
        test.env as never,
      );

      expect(response.status).toBe(500);
    });
  });
});

/* ------------------------------------- 6. malformed claim cookies deny */

/**
 * A claim cookie is caller-supplied text. A corrupted value is not a parseable
 * Convex id and the row lookup THROWS rather than returning null — so with the
 * rail no longer absorbing arbitrary admission-path throws as denials, the
 * adapter has to catch it. A garbage cookie is a refusal, not an outage.
 */
describe("malformed claim cookies are denied, not faults", () => {
  function throwingRowHarness() {
    const ctx = {
      auth: { getUserIdentity: async () => null },
      db: {
        get: async () => {
          throw new Error("Invalid argument `id`: not a valid document id");
        },
      },
    } as any;

    const calls: { name: string; args: any }[] = [];
    const dispatch = async (ref: any, args: any) => {
      const name = getFunctionName(ref);
      if (name === ADMIT_WRITE) return await admitOperationWithCtx(ctx, args);
      if (name === ADMIT_READ) return await admitReadOperationWithCtx(ctx, args);
      calls.push({ name, args });
      return null;
    };

    return {
      calls,
      env: { runMutation: dispatch, runQuery: dispatch, runAction: dispatch },
    };
  }

  for (const cookie of [
    "user_id=not-an-id; store_id=store-1",
    "guest_id=not-an-id; store_id=store-1",
  ]) {
    it(`denies "${cookie}" without reaching the handler`, async () => {
      await withOrigin(async () => {
        const test = throwingRowHarness();

        const response = await bagRoutes.fetch(
          request("/bag-1/items", {
            method: "POST",
            cookie,
            origin: ALLOWED_ORIGIN,
            body: { productId: "product-1", quantity: 1 },
          }),
          test.env as never,
        );

        expect(response.status).toBe(403);
        expect(test.calls).toEqual([]);
      });
    });
  }
});
