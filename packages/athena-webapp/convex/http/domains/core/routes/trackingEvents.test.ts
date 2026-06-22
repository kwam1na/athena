import { describe, expect, it } from "vitest";

import {
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
});
