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
  const checkoutStateChanged = findRegisteredContextEvent({
    surface: "storefront",
    eventId: "storefront.checkout_state_changed",
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

  it("rejects raw checkout error text and free-form blocker values", () => {
    expect(checkoutStateChanged).toBeDefined();

    expect(
      validateRegisteredContextEventPayload(checkoutStateChanged!, {
        checkoutSessionId: "checkout_123",
        state: "Card was declined by Stripe because the CVV failed",
      }),
    ).toEqual({ ok: false, message: "Invalid payload value: state" });

    expect(
      validateRegisteredContextEventPayload(checkoutStateChanged!, {
        checkoutSessionId: "checkout_123",
        state: "blocked",
        blocker: "Customer wrote call me at customer@example.com",
      }),
    ).toEqual({ ok: false, message: "Invalid payload value: blocker" });
  });

  it("accepts only server-allowlisted checkout state and blocker codes", () => {
    expect(
      validateRegisteredContextEventPayload(checkoutStateChanged!, {
        checkoutSessionId: "checkout_123",
        state: "blocked",
        blocker: "inventory",
      }),
    ).toEqual({ ok: true });

    expect(
      validateRegisteredContextEventPayload(checkoutStateChanged!, {
        checkoutSessionId: "checkout_123",
        state: "requires_action",
        blocker: "payment_provider",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects raw URLs and contact-bearing route values", () => {
    const routeViewed = findRegisteredContextEvent({
      surface: "storefront",
      eventId: "storefront.route_viewed",
      schemaVersion: 1,
    });

    expect(
      validateRegisteredContextEventPayload(routeViewed!, {
        route: "https://wigclub.store/products?email=customer@example.com",
      }),
    ).toEqual({ ok: false, message: "Unsafe payload value: route" });
  });
});

describe("shared demo context event definitions", () => {
  const findSharedDemoEvent = (eventId: string) =>
    findRegisteredContextEvent({
      surface: "shared_demo",
      eventId,
      schemaVersion: 1,
    });

  it("registers every shared demo event as support-visible", () => {
    for (const eventId of [
      "shared_demo.session_started",
      "shared_demo.surface_viewed",
      "shared_demo.surface_blocked",
      "shared_demo.action_admitted",
      "shared_demo.action_denied",
      "shared_demo.restore_observed",
    ]) {
      const registration = findSharedDemoEvent(eventId);
      expect(registration, eventId).toBeDefined();
      // Demo visitors share one store and are store admins of it. Anything
      // store-visible would let one visitor read another's activity.
      expect(registration!.visibilityMode, eventId).toBe("support");
    }
  });

  it("accepts a catalog surface view carrying its route template", () => {
    expect(
      validateRegisteredContextEventPayload(
        findSharedDemoEvent("shared_demo.surface_viewed")!,
        {
          surfaceKey: "pos.checkout",
          routeTemplate: "/:orgUrlSlug/store/:storeUrlSlug/pos",
          presentation: "interactive",
        },
      ),
    ).toEqual({ ok: true });
  });

  it("rejects a concrete pathname in place of a route template", () => {
    expect(
      validateRegisteredContextEventPayload(
        findSharedDemoEvent("shared_demo.surface_viewed")!,
        {
          surfaceKey: "pos.checkout",
          routeTemplate: "/demo/store/central/pos?email=visitor@example.com",
        },
      ),
    ).toEqual({ ok: false, message: "Unsafe payload value: routeTemplate" });
  });

  it("accepts closed operation and capability identifiers verbatim", () => {
    // These are server-generated ids from a compile-time catalog, not visitor
    // text. They legitimately contain words the free-text sensitivity scan
    // rejects, so they validate as closed identifiers instead.
    expect(
      validateRegisteredContextEventPayload(
        findSharedDemoEvent("shared_demo.action_admitted")!,
        {
          operationId: "cashControls/deposits.recordRegisterSessionDeposit",
          capability: "cash.control.write",
        },
      ),
    ).toEqual({ ok: true });

    expect(
      validateRegisteredContextEventPayload(
        findSharedDemoEvent("shared_demo.action_admitted")!,
        {
          operationId: "pos/public/transactions.correctTransactionPaymentMethod",
          capability: "payments.refund",
        },
      ),
    ).toEqual({ ok: true });
  });

  it("keeps the client-reportable surface key on the sensitivity scan", () => {
    // surfaceKey is an allowed payload key on the events a browser may report,
    // so it must not get the closed-identifier bypass that operationId and
    // capability get. Those two are server-generated and never client-supplied.
    expect(
      validateRegisteredContextEventPayload(
        findSharedDemoEvent("shared_demo.action_denied")!,
        { reason: "demo_policy", surfaceKey: "visitor.token.ab12cd" },
      ),
    ).toEqual({ ok: false, message: "Invalid payload value: surfaceKey" });

    expect(
      validateRegisteredContextEventPayload(
        findSharedDemoEvent("shared_demo.surface_viewed")!,
        {
          surfaceKey: "pos.checkout",
          routeTemplate: "/:orgUrlSlug/store/:storeUrlSlug/pos",
        },
      ),
    ).toEqual({ ok: true });
  });

  it("accepts every real view-surface key under the sensitivity scan", () => {
    // Guards the fix above from over-correcting: no key in the shipped surface
    // catalog may be rejected by the scan it now passes through.
    for (const surfaceKey of [
      "pos.checkout",
      "pos.sales_history",
      "pos.terminal_health",
      "cash.register_control",
      "storefront.checkout_sessions",
      "orders.fulfillment",
      "administration.app_settings",
      "observability.workflow_trace",
      "services.catalog_management",
      "demo.owner_orientation",
    ]) {
      expect(
        validateRegisteredContextEventPayload(
          findSharedDemoEvent("shared_demo.action_denied")!,
          { reason: "demo_policy", surfaceKey },
        ),
        surfaceKey,
      ).toEqual({ ok: true });
    }
  });

  it("rejects free-form text smuggled into a closed identifier", () => {
    expect(
      validateRegisteredContextEventPayload(
        findSharedDemoEvent("shared_demo.action_admitted")!,
        {
          operationId: "pos/public/transactions.completeTransaction",
          capability: "sold 3 wigs to jane@example.com",
        },
      ),
    ).toEqual({ ok: false, message: "Invalid payload value: capability" });
  });

  it("accepts only allowlisted enumeration codes", () => {
    expect(
      validateRegisteredContextEventPayload(
        findSharedDemoEvent("shared_demo.session_started")!,
        { entryKind: "fresh", baselineVersion: 30, restoreEpoch: 12 },
      ),
    ).toEqual({ ok: true });

    expect(
      validateRegisteredContextEventPayload(
        findSharedDemoEvent("shared_demo.session_started")!,
        { entryKind: "curious about pricing" },
      ),
    ).toEqual({ ok: false, message: "Invalid payload value: entryKind" });

    expect(
      validateRegisteredContextEventPayload(
        findSharedDemoEvent("shared_demo.restore_observed")!,
        { phase: "failed", epoch: 12 },
      ),
    ).toEqual({ ok: true });

    expect(
      validateRegisteredContextEventPayload(
        findSharedDemoEvent("shared_demo.surface_blocked")!,
        { routeTemplate: "/:orgUrlSlug/store/:storeUrlSlug/members", reason: "not_visible" },
      ),
    ).toEqual({ ok: true });

    expect(
      validateRegisteredContextEventPayload(
        findSharedDemoEvent("shared_demo.action_denied")!,
        { reason: "capability_denied", surfaceKey: "administration.members" },
      ),
    ).toEqual({ ok: true });
  });

  it("rejects payload keys outside the registration", () => {
    expect(
      validateRegisteredContextEventPayload(
        findSharedDemoEvent("shared_demo.surface_viewed")!,
        {
          surfaceKey: "reports",
          routeTemplate: "/:orgUrlSlug/store/:storeUrlSlug/reports",
          note: "spent a while here",
        },
      ),
    ).toEqual({ ok: false, message: "Unexpected payload key: note" });
  });
});
