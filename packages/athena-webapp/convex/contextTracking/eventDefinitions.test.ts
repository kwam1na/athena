import { describe, expect, it } from "vitest";

import {
  findRegisteredContextEvent,
  validateRegisteredContextEventPayload,
} from "./eventDefinitions";

describe("context tracking event definitions", () => {
  const productViewed = findRegisteredContextEvent({
    surface: "storefront",
    eventId: "storefront.product_viewed",
    schemaVersion: 1,
  });

  it("accepts registered payload keys with primitive values", () => {
    expect(productViewed).toBeDefined();

    expect(
      validateRegisteredContextEventPayload(productViewed!, {
        productId: "product_123",
        categorySlug: "wigs",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects unexpected payload keys", () => {
    expect(
      validateRegisteredContextEventPayload(productViewed!, {
        productId: "product_123",
        email: "customer@example.com",
      }),
    ).toEqual({ ok: false, message: "Unexpected payload key: email" });
  });

  it("rejects nested payload values", () => {
    expect(
      validateRegisteredContextEventPayload(productViewed!, {
        productId: "product_123",
        sku: { value: "sku_123" },
      }),
    ).toEqual({ ok: false, message: "Invalid payload value: sku" });
  });
});
