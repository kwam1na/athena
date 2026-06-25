import { describe, expect, it } from "vitest";

import {
  buildServerContextTrackingEnvelope,
  deriveContextEnvironment,
  derivePrimarySubject,
  isAllowedTrackingOrigin,
} from "./trackingEvents";

describe("tracking event route origin policy", () => {
  it("accepts owned storefront origins", () => {
    expect(isAllowedTrackingOrigin("https://wigclub.store")).toBe(true);
    expect(isAllowedTrackingOrigin("https://www.wigclub.store")).toBe(true);
    expect(isAllowedTrackingOrigin("https://dev.wigclub.store")).toBe(true);
  });

  it("rejects unowned preview and malformed origins", () => {
    expect(isAllowedTrackingOrigin("https://attacker.vercel.app")).toBe(false);
    expect(isAllowedTrackingOrigin("https://evil.example.com")).toBe(false);
    expect(isAllowedTrackingOrigin("not a url")).toBe(false);
  });
});

describe("tracking event route subject derivation", () => {
  it("derives product subjects from payload product id", () => {
    expect(
      derivePrimarySubject("storefront.product_viewed", {
        productId: "product_123",
      }),
    ).toEqual({ type: "product", id: "product_123" });
  });

  it("ignores client-provided subject refs when deriving from payload", () => {
    expect(
      derivePrimarySubject("storefront.product_viewed", {
        productId: "product_real",
        primarySubject: "product_spoofed",
      }),
    ).toEqual({ type: "product", id: "product_real" });
  });

  it("does not derive subjects for route views", () => {
    expect(
      derivePrimarySubject("storefront.route_viewed", {
        route: "/shop",
      }),
    ).toBeUndefined();
  });

  it("derives trusted envelope fields from the server request boundary", () => {
    expect(
      buildServerContextTrackingEnvelope({
        body: {
          surface: "storefront",
          eventId: "storefront.product_viewed",
          schemaVersion: 1,
          idempotencyKey: "product:1",
          occurredAt: 1_700_000_000_000,
          origin: "synthetic_monitor",
          payload: { productId: "product_1" },
          actorRef: { kind: "system", id: "forged" },
          sourceRefs: [{ table: "analytics", id: "forged" }],
          synthetic: true,
          sessionRef: { kind: "storefront_session", id: "forged_guest_1" },
        },
        storeId: "store_1" as never,
        organizationId: "org_1" as never,
        originHeader: "https://wigclub.store",
        ipAddress: "203.0.113.9",
        storefrontActor: { kind: "guest", id: "guest_1" },
      }),
    ).toMatchObject({
      origin: "https://wigclub.store",
      actorRef: { kind: "guest", id: "guest_1" },
      primarySubject: { type: "product", id: "product_1" },
      subjectRefs: [{ type: "product", id: "product_1" }],
      sessionRef: undefined,
      sourceRefs: [],
      synthetic: false,
      environment: {
        deviceClass: "unknown",
        browserFamily: "unknown",
        osFamily: "unknown",
        viewportBucket: "unknown",
      },
      abusePartitionKey: "store_1:actor:guest:guest_1",
    });
  });

  it("derives coarse device context from request headers and client viewport buckets", () => {
    expect(
      buildServerContextTrackingEnvelope({
        body: {
          surface: "storefront",
          eventId: "storefront.route_viewed",
          schemaVersion: 1,
          idempotencyKey: "route:mobile",
          occurredAt: 1_700_000_000_000,
          payload: { route: "/shop" },
          environment: {
            deviceClass: "desktop",
            browserFamily: "firefox",
            osFamily: "windows",
            viewportBucket: "sm",
          },
        },
        storeId: "store_1" as never,
        organizationId: "org_1" as never,
        originHeader: "https://wigclub.store",
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      }),
    ).toMatchObject({
      environment: {
        deviceClass: "mobile",
        browserFamily: "safari",
        osFamily: "ios",
        viewportBucket: "sm",
      },
    });
  });

  it("classifies tablets and bots without storing raw user-agent text", () => {
    expect(
      deriveContextEnvironment({
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1",
        viewportBucket: "lg",
      }),
    ).toEqual({
      deviceClass: "tablet",
      browserFamily: "safari",
      osFamily: "ios",
      viewportBucket: "lg",
    });

    expect(
      deriveContextEnvironment({
        userAgent: "AthenaSyntheticBot/1.0",
      }),
    ).toMatchObject({
      deviceClass: "bot",
      browserFamily: "other",
      osFamily: "other",
      viewportBucket: "unknown",
    });
  });

  it("does not let anonymous clients forge quota partitions with session refs or IP headers", () => {
    expect(
      buildServerContextTrackingEnvelope({
        body: {
          surface: "storefront",
          eventId: "storefront.route_viewed",
          schemaVersion: 1,
          idempotencyKey: "route:1",
          occurredAt: 1_700_000_000_000,
          payload: { route: "/shop" },
          sessionRef: { kind: "storefront_session", id: "rotating_session" },
        },
        storeId: "store_1" as never,
        organizationId: "org_1" as never,
        originHeader: "https://wigclub.store",
        ipAddress: "198.51.100.12",
      }),
    ).toMatchObject({
      actorRef: undefined,
      sessionRef: undefined,
      sourceRefs: [],
      abusePartitionKey: "store_1:anonymous",
    });
  });

  it("marks synthetic only for accepted automation request context", () => {
    expect(
      buildServerContextTrackingEnvelope({
        body: {
          surface: "storefront",
          eventId: "storefront.route_viewed",
          schemaVersion: 1,
          idempotencyKey: "route:synthetic",
          occurredAt: 1_700_000_000_000,
          origin: "synthetic_monitor",
          payload: { route: "/shop" },
        },
        storeId: "store_1" as never,
        organizationId: "org_1" as never,
        originHeader: "https://wigclub.store",
        syntheticHeader: "true",
      }),
    ).toMatchObject({
      synthetic: true,
      origin: "synthetic_monitor",
    });
  });
});
