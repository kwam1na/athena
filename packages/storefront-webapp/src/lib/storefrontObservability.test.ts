import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SYNTHETIC_MONITOR_ORIGIN,
  STOREFRONT_OBSERVABILITY_ACTION,
  STOREFRONT_OBSERVABILITY_SESSION_KEY,
  createStorefrontObservabilityContext,
  createStorefrontObservabilityPayload,
  getOrCreateStorefrontObservabilitySessionId,
  isSyntheticMonitorOrigin,
  resolveStorefrontAnalyticsOrigin,
  resolveViewportBucket,
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
      viewportWidth: 390,
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
      viewportBucket: "sm",
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

  it("buckets viewport widths without storing raw dimensions", () => {
    expect(resolveViewportBucket(375)).toBe("sm");
    expect(resolveViewportBucket(800)).toBe("md");
    expect(resolveViewportBucket(1100)).toBe("lg");
    expect(resolveViewportBucket(1440)).toBe("xl");
    expect(resolveViewportBucket(Number.NaN)).toBe("unknown");
  });

  it("reserves a canonical origin for synthetic monitors in browser automation", () => {
    const context = createStorefrontObservabilityContext({
      pathname: "/shop/checkout",
      search: {
        origin: SYNTHETIC_MONITOR_ORIGIN,
      },
      isBrowserAutomation: true,
      storage,
    });

    expect(context.origin).toBe(SYNTHETIC_MONITOR_ORIGIN);
    expect(isSyntheticMonitorOrigin(context.origin)).toBe(true);
    expect(isSyntheticMonitorOrigin("homepage")).toBe(false);
  });

  it("does not treat bare synthetic query params as monitor traffic in normal browsers", () => {
    const context = createStorefrontObservabilityContext({
      pathname: "/shop/checkout",
      search: {
        origin: SYNTHETIC_MONITOR_ORIGIN,
        utm_source: "newsletter",
      },
      isBrowserAutomation: false,
      storage,
    });

    expect(context.origin).toBe("newsletter");
  });

  it("lets synthetic automation override explicit customer origins", () => {
    expect(
      resolveStorefrontAnalyticsOrigin({
        explicitOrigin: "homepage",
        searchOrigin: SYNTHETIC_MONITOR_ORIGIN,
        isBrowserAutomation: true,
      }),
    ).toBe(SYNTHETIC_MONITOR_ORIGIN);

    expect(
      resolveStorefrontAnalyticsOrigin({
        explicitOrigin: "homepage",
        searchOrigin: SYNTHETIC_MONITOR_ORIGIN,
        isBrowserAutomation: false,
      }),
    ).toBe("homepage");
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

  it("emits context-bearing events through the tracking-events helper", async () => {
    const legacyTransport = vi.fn().mockResolvedValue({ ok: true });
    const contextTransport = vi.fn().mockResolvedValue({ ok: true });

    await trackStorefrontEvent({
      event: {
        journey: "bag",
        step: "bag_view",
        status: "viewed",
        context: {
          bagId: "bag_123",
        },
      },
      baseContext: {
        route: "/shop/bag",
        origin: "homepage",
        sessionId: "session_ctx_123",
        userType: "authenticated",
      },
      transport: legacyTransport,
      contextTransport,
    });

    expect(legacyTransport).not.toHaveBeenCalled();
    expect(contextTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "storefront",
        eventId: "storefront.cart_changed",
        payload: {
          cartId: "bag_123",
          change: "viewed",
        },
        sessionRef: {
          kind: "storefront_session",
          id: "session_ctx_123",
        },
      }),
    );
  });

  it("keeps non-context observability events on the legacy helper", async () => {
    const transport = vi.fn().mockResolvedValue({ ok: true });
    const contextTransport = vi.fn().mockResolvedValue({ ok: true });

    await trackStorefrontEvent({
      event: {
        journey: "auth",
        step: "login_entry",
        status: "viewed",
        context: {
          entryOrigin: "guest-rewards",
        },
      },
      baseContext: {
        route: "/login",
        origin: "homepage",
        sessionId: "session_ctx_123",
        userType: "authenticated",
      },
      transport,
      contextTransport,
    });

    expect(contextTransport).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledWith({
      action: STOREFRONT_OBSERVABILITY_ACTION,
      origin: "homepage",
      productId: undefined,
      data: {
        schemaVersion: 1,
        journey: "auth",
        step: "login_entry",
        status: "viewed",
        route: "/login",
        userType: "authenticated",
        sessionId: "session_ctx_123",
        entryOrigin: "guest-rewards",
      },
    });
  });
});
