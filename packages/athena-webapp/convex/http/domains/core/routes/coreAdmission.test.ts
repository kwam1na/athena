import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HTTP_CORE_DEFINITIONS,
  appendStorefrontTrackingEventRouteOperationDefinition,
  createAnalyticsEventRouteOperationDefinition,
  verifyStorefrontAuthCodeRouteOperationDefinition,
} from "../../../../operationAdmission/domains/httpCore_definitions";
import {
  HTTP_CORE_READ_DEFINITIONS,
  listRedeemedPromoCodesRouteReadDefinition,
} from "../../../../operationAdmission/domains/httpCore_readDefinitions";
import { validateOperationDefinition } from "../../../../operationAdmission/definitions";
import { validateReadOperationDefinition } from "../../../../operationAdmission/readDefinitions";
import {
  createHarnessWaiverBrokerVerifier,
  createMarketingOriginVerifier,
  createMtnMomoCallbackVerifier,
  createWhatsAppSignatureVerifier,
  isAllowedTrackingOrigin,
} from "../../../../operationAdmission/ingressVerification";
import { analyticsRoutes } from "./analytics";
import { storeRoutes } from "./stores";
import { trackingEventRoutes } from "./trackingEvents";

const STORE = "store_1" as never;
const GUEST = "guest_1" as never;

/**
 * The admission entry point the HTTP wrappers call. Its projection is what the
 * handlers derive `owner` from, so the tests hand back a real one rather than
 * letting an undefined admission slip through unnoticed.
 */
function customerBindings(
  actor: Record<string, unknown> = {
    kind: "storefront_customer",
    assurance: "bearer_id",
    storeId: STORE,
    guestId: GUEST,
  },
) {
  const admission = {
    actor,
    constraints: { storeId: STORE },
    decision: { adapter: actor.kind, outcome: "admitted" },
    operationId: "test",
    provenance: {},
  };
  const runMutation = vi.fn().mockImplementation((_reference, args) =>
    (args as { operationId?: string })?.operationId
      ? Promise.resolve(admission)
      : Promise.resolve({ ok: true }),
  );
  const runQuery = vi.fn().mockImplementation((_reference, args) =>
    (args as { operationId?: string })?.operationId
      ? Promise.resolve(admission)
      : Promise.resolve([]),
  );
  return { runMutation, runQuery, runAction: vi.fn() };
}

const domainCalls = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls.filter(
    (call) => (call[1] as { operationId?: string })?.operationId === undefined,
  );

describe("U11 route definitions", () => {
  it("declares every core, messaging and money-movement route validly", () => {
    for (const definition of HTTP_CORE_DEFINITIONS) {
      expect({
        operationId: definition.operationId,
        errors: validateOperationDefinition(definition),
      }).toEqual({ operationId: definition.operationId, errors: [] });
    }
    for (const definition of HTTP_CORE_READ_DEFINITIONS) {
      expect({
        operationId: definition.operationId,
        errors: validateReadOperationDefinition(definition),
      }).toEqual({ operationId: definition.operationId, errors: [] });
    }
  });

  it("never widens shared demo reach", () => {
    for (const definition of [
      ...HTTP_CORE_DEFINITIONS,
      ...HTTP_CORE_READ_DEFINITIONS,
    ]) {
      expect([definition.operationId, definition.actors.sharedDemo]).toEqual([
        definition.operationId,
        "deny",
      ]);
    }
  });

  it("gives every anonymous write a declared verifier and every customer write the origin allowlist", () => {
    for (const definition of HTTP_CORE_DEFINITIONS) {
      if (definition.actors.public === "admit") {
        expect([
          definition.operationId,
          definition.ingressVerification !== undefined,
        ]).toEqual([definition.operationId, true]);
      }
      if (definition.actors.storefrontCustomer === "admit") {
        // Mutually exclusive with public, and cookie-driven, so it is fenced by
        // the storefront origin allowlist.
        expect([
          definition.operationId,
          definition.actors.public,
          definition.ingressVerification?.kind,
        ]).toEqual([definition.operationId, "deny", "origin_allowlist"]);
      }
    }
  });

  it("keeps the one shopper-scoped core read claim-only", () => {
    expect(listRedeemedPromoCodesRouteReadDefinition.actors).toEqual({
      normalUser: "deny",
      sharedDemo: "deny",
      storefrontCustomer: "admit",
      public: "deny",
    });
  });
});

describe("U11 ingress verifiers", () => {
  it("fails closed when a webhook secret is absent", async () => {
    await expect(
      createWhatsAppSignatureVerifier({})({
        headers: new Headers({ "x-hub-signature-256": "sha256=deadbeef" }),
        rawBody: "{}",
        request: new Request("https://athena.example/webhooks/whatsapp"),
      }),
    ).resolves.toBe(false);

    expect(
      await createMtnMomoCallbackVerifier({})({
        headers: new Headers({ "x-callback-secret": "anything" }),
        rawBody: "{}",
        request: new Request("https://athena.example/webhooks/mtn-momo/collections"),
      }),
    ).toBe(false);

    expect(
      await createHarnessWaiverBrokerVerifier({})({
        headers: new Headers({ authorization: "Bearer anything" }),
        rawBody: "",
        request: new Request("https://athena.example/harness/waivers/requests"),
      }),
    ).toBe(false);

    expect(
      // Empty allowlist denies, same fail-closed shape as an absent one.
      await createMarketingOriginVerifier(() => [])({
        headers: new Headers({ Origin: "https://athena.example" }),
        rawBody: "{}",
        request: new Request("https://athena.example/marketing/funnel-events"),
      }),
    ).toBe(false);

    // One resolver, shared with the handler: an origin the injected resolver
    // allows (including a local origin enabled via
    // WALKTHROUGH_ALLOW_LOCAL_ORIGINS) is admitted, and one it does not is not.
    expect(
      await createMarketingOriginVerifier(() => ["http://localhost:3000"])({
        headers: new Headers({ Origin: "http://localhost:3000" }),
        rawBody: "{}",
        request: new Request("https://athena.example/marketing/funnel-events"),
      }),
    ).toBe(true);
    expect(
      await createMarketingOriginVerifier(() => ["https://marketing.test"])({
        headers: new Headers({ Origin: "https://evil.test" }),
        rawBody: "{}",
        request: new Request("https://athena.example/marketing/funnel-events"),
      }),
    ).toBe(false);
    // A resolver that throws on malformed config denies rather than admitting.
    expect(
      await createMarketingOriginVerifier(() => {
        throw new Error("malformed WALKTHROUGH_ALLOWED_ORIGINS");
      })({
        headers: new Headers({ Origin: "https://marketing.test" }),
        rawBody: "{}",
        request: new Request("https://athena.example/marketing/funnel-events"),
      }),
    ).toBe(false);
  });

  it("accepts only the exact configured secret", async () => {
    const environment = { ATHENA_WAIVER_BROKER_SECRET: "broker-secret" };
    const verify = createHarnessWaiverBrokerVerifier(environment);
    const input = (authorization: string) => ({
      headers: new Headers({ authorization }),
      rawBody: "",
      request: new Request("https://athena.example/harness/waivers/requests"),
    });

    expect(await verify(input("Bearer broker-secret"))).toBe(true);
    expect(await verify(input("Bearer broker-secre"))).toBe(false);
    expect(await verify(input("Bearer wrong-secret!"))).toBe(false);
    expect(await verify(input("Basic broker-secret"))).toBe(false);
  });

  it("verifies the MTN callback secret from the header or the callback URL", async () => {
    const verify = createMtnMomoCallbackVerifier({
      MTN_MOMO_COLLECTIONS_CALLBACK_SECRET: "mtn-secret",
    });
    const url =
      "https://athena.example/webhooks/mtn-momo/collections?storeId=store_1";

    expect(
      await verify({
        headers: new Headers({ "x-callback-secret": "mtn-secret" }),
        rawBody: "{}",
        request: new Request(url),
      }),
    ).toBe(true);
    expect(
      await verify({
        headers: new Headers(),
        rawBody: "{}",
        request: new Request(`${url}&callbackSecret=mtn-secret`),
      }),
    ).toBe(true);
    expect(
      await verify({
        headers: new Headers(),
        rawBody: "{}",
        request: new Request(`${url}&callbackSecret=wrong`),
      }),
    ).toBe(false);
    expect(
      await verify({
        headers: new Headers(),
        rawBody: "{}",
        request: new Request(url),
      }),
    ).toBe(false);
  });

  it("signs the WhatsApp digest over the raw body the handler parses", async () => {
    const secret = "app-secret";
    const rawBody = JSON.stringify({ entry: [] });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
    );
    const signature = `sha256=${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const verify = createWhatsAppSignatureVerifier({
      WHATSAPP_WEBHOOK_APP_SECRET: secret,
    });
    const request = new Request("https://athena.example/webhooks/whatsapp");

    expect(
      await verify({
        headers: new Headers({ "x-hub-signature-256": signature }),
        rawBody,
        request,
      }),
    ).toBe(true);
    // A signature that covers different bytes than the handler will parse is
    // exactly what this must refuse.
    expect(
      await verify({
        headers: new Headers({ "x-hub-signature-256": signature }),
        rawBody: `${rawBody} `,
        request,
      }),
    ).toBe(false);
  });

  it("keeps the tracking origin fence on owned storefront hosts only", () => {
    expect(isAllowedTrackingOrigin("https://wigclub.store")).toBe(true);
    expect(isAllowedTrackingOrigin("https://attacker.vercel.app")).toBe(false);
    expect(isAllowedTrackingOrigin("not a url")).toBe(false);
    expect(isAllowedTrackingOrigin(undefined)).toBe(false);
  });
});

describe("U11 admitted route handlers", () => {
  beforeEach(() => {
    process.env.ATHENA_STOREFRONT_ALLOWED_ORIGINS = "https://wigclub.store";
  });

  afterEach(() => {
    delete process.env.ATHENA_STOREFRONT_ALLOWED_ORIGINS;
  });

  it("attributes an analytics event to the admitted shopper, not to the cookie", async () => {
    const bindings = customerBindings();

    const response = await analyticsRoutes.request(
      "/",
      {
        method: "POST",
        headers: {
          origin: "https://wigclub.store",
          "content-type": "application/json",
          // A forged claim for another shopper in another store.
          cookie: "guest_id=guest_forged; store_id=store_forged",
        },
        body: JSON.stringify({ action: "viewed", data: {} }),
      },
      bindings as never,
    );

    expect(response.status).toBe(200);
    const [, args] = domainCalls(bindings.runMutation)[0];
    expect(args).toMatchObject({
      action: "viewed",
      owner: { storeId: STORE, guestId: GUEST },
    });
    expect(args).not.toHaveProperty("storeId");
    expect(args).not.toHaveProperty("storeFrontUserId");
  });

  it("refuses an analytics write from an origin outside the allowlist", async () => {
    const bindings = customerBindings();

    const response = await analyticsRoutes.request(
      "/",
      {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
          cookie: "guest_id=guest_1",
        },
        body: JSON.stringify({ action: "viewed", data: {} }),
      },
      bindings as never,
    );

    expect(response.status).toBe(403);
    expect(bindings.runMutation).not.toHaveBeenCalled();
  });

  it("reads a shopper's redemptions by the admitted id rather than the cookie", async () => {
    const bindings = customerBindings();

    const response = await storeRoutes.request(
      "/redeemedPromoCodes",
      { headers: { cookie: "guest_id=guest_forged" } },
      bindings as never,
    );

    expect(response.status).toBe(200);
    expect(domainCalls(bindings.runQuery)[0][1]).toEqual({
      storeFrontUserId: GUEST,
    });
  });

  it("records no actor for the anonymous tracking beacon", async () => {
    const bindings = customerBindings({ kind: "public" });

    const response = await trackingEventRoutes.request(
      "/",
      {
        method: "POST",
        headers: {
          origin: "https://wigclub.store",
          "content-type": "application/json",
          cookie: "guest_id=guest_forged; store_id=store_1; organization_id=org_1",
        },
        body: JSON.stringify({
          surface: "storefront",
          eventId: "storefront.route_viewed",
          schemaVersion: 1,
          idempotencyKey: "route:1",
          occurredAt: 1_700_000_000_000,
          payload: {},
        }),
      },
      {
        ...bindings,
        runMutation: vi.fn().mockImplementation((_reference, args) =>
          (args as { operationId?: string })?.operationId
            ? Promise.resolve({ actor: { kind: "public" } })
            : Promise.resolve({ kind: "appended" }),
        ),
      } as never,
    );

    expect(response.status).toBe(200);
  });

  it("declares the tracking beacon and the analytics beacon as different actors", () => {
    expect(
      appendStorefrontTrackingEventRouteOperationDefinition.actors.public,
    ).toBe("admit");
    expect(
      createAnalyticsEventRouteOperationDefinition.actors.storefrontCustomer,
    ).toBe("admit");
    expect(
      verifyStorefrontAuthCodeRouteOperationDefinition.actors.public,
    ).toBe("deny");
  });
});
