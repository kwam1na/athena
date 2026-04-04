import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  STOREFRONT_OBSERVABILITY_ACTION,
  STOREFRONT_OBSERVABILITY_SESSION_KEY,
  createStorefrontObservabilityContext,
  createStorefrontObservabilityPayload,
  getOrCreateStorefrontObservabilitySessionId,
  trackStorefrontEvent,
} from "./storefrontObservability";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.get(key) ?? null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, value);
    },
  };
}

describe("storefront observability", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it("creates a normalized payload with standard metadata", () => {
    const payload = createStorefrontObservabilityPayload(
      {
        journey: "checkout",
        step: "payment_submission",
        status: "started",
        context: {
          checkoutSessionId: "session_123",
          orderId: "order_123",
          productId: "product_123",
        },
      },
      {
        route: "/shop/checkout/session_123",
        origin: "homepage",
        sessionId: "session_ctx_123",
        userType: "guest",
      },
    );

    expect(payload).toEqual({
      action: STOREFRONT_OBSERVABILITY_ACTION,
      origin: "homepage",
      productId: "product_123",
      data: {
        schemaVersion: 1,
        journey: "checkout",
        step: "payment_submission",
        status: "started",
        route: "/shop/checkout/session_123",
        userType: "guest",
        sessionId: "session_ctx_123",
        checkoutSessionId: "session_123",
        orderId: "order_123",
        productId: "product_123",
      },
    });
  });

  it("resolves origin, user type, and a stable session id from runtime context", () => {
    const firstContext = createStorefrontObservabilityContext({
      pathname: "/shop",
      search: {
        utm_source: "instagram",
      },
      guestId: "guest_123",
      storage,
    });

    const secondContext = createStorefrontObservabilityContext({
      pathname: "/shop/bag",
      search: {
        origin: "homepage",
      },
      guestId: "guest_123",
      storage,
    });

    expect(firstContext).toMatchObject({
      route: "/shop",
      origin: "instagram",
      userType: "guest",
    });
    expect(secondContext).toMatchObject({
      route: "/shop/bag",
      origin: "homepage",
      userType: "guest",
    });
    expect(firstContext.sessionId).toBe(secondContext.sessionId);
    expect(storage.getItem(STOREFRONT_OBSERVABILITY_SESSION_KEY)).toBe(
      firstContext.sessionId,
    );
    expect(getOrCreateStorefrontObservabilitySessionId(storage)).toBe(
      firstContext.sessionId,
    );
  });

  it("fails predictably when required event fields are invalid", () => {
    expect(() =>
      createStorefrontObservabilityPayload(
        {
          journey: "checkout",
          step: "Checkout Step",
          status: "started",
        },
        {
          route: "/shop/checkout",
          sessionId: "session_ctx_123",
          userType: "authenticated",
        },
      ),
    ).toThrow(/step/i);
  });

  it("emits representative events through the shared helper", async () => {
    const transport = vi.fn().mockResolvedValue({ ok: true });

    await trackStorefrontEvent({
      event: {
        journey: "bag",
        step: "bag_view",
        status: "viewed",
        context: {
          checkoutSessionId: "session_123",
        },
      },
      baseContext: {
        route: "/shop/bag",
        origin: "homepage",
        sessionId: "session_ctx_123",
        userType: "authenticated",
      },
      transport,
    });

    expect(transport).toHaveBeenCalledWith({
      action: STOREFRONT_OBSERVABILITY_ACTION,
      origin: "homepage",
      productId: undefined,
      data: {
        schemaVersion: 1,
        journey: "bag",
        step: "bag_view",
        status: "viewed",
        route: "/shop/bag",
        userType: "authenticated",
        sessionId: "session_ctx_123",
        checkoutSessionId: "session_123",
      },
    });
  });
});
