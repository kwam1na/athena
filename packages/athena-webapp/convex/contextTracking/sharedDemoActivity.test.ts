import { describe, expect, it } from "vitest";

import { foldSharedDemoActivity } from "./sharedDemoActivity";

const start = 1_760_000_000_000;

let sequence = 0;
function event(
  eventId: string,
  visitor: string,
  payload: Record<string, string | number>,
  overrides: { occurredAt?: number; sessionId?: string } = {},
) {
  sequence += 1;
  return {
    eventId,
    occurredAt: overrides.occurredAt ?? start + sequence * 1_000,
    payload,
    actorRefId: visitor,
    sessionRefId: overrides.sessionId ?? `${visitor}-session`,
  };
}

describe("shared demo activity fold", () => {
  it("reports an empty window without inventing activity", () => {
    const rollup = foldSharedDemoActivity([]);

    expect(rollup.visitorCount).toBe(0);
    expect(rollup.sessionCount).toBe(0);
    expect(rollup.surfacesReached).toEqual([]);
    expect(rollup.explorationDepth).toEqual({ median: 0, max: 0 });
    expect(rollup.visitorsWhoActed).toBe(0);
  });

  it("counts visitors by auth user and sessions by browser session", () => {
    const rollup = foldSharedDemoActivity([
      event("shared_demo.session_started", "visitor_a", { entryKind: "fresh" }),
      event(
        "shared_demo.surface_viewed",
        "visitor_a",
        { surfaceKey: "pos.checkout", routeTemplate: "/a" },
        { sessionId: "visitor_a-second-tab" },
      ),
      event("shared_demo.session_started", "visitor_b", { entryKind: "fresh" }),
    ]);

    expect(rollup.visitorCount).toBe(2);
    expect(rollup.sessionCount).toBe(3);
  });

  it("ranks surfaces by how many distinct visitors reached them", () => {
    const rollup = foldSharedDemoActivity([
      event("shared_demo.surface_viewed", "visitor_a", {
        surfaceKey: "reports",
        routeTemplate: "/reports",
      }),
      event("shared_demo.surface_viewed", "visitor_a", {
        surfaceKey: "pos.checkout",
        routeTemplate: "/pos",
      }),
      event("shared_demo.surface_viewed", "visitor_b", {
        surfaceKey: "pos.checkout",
        routeTemplate: "/pos",
      }),
      event("shared_demo.surface_viewed", "visitor_c", {
        surfaceKey: "pos.checkout",
        routeTemplate: "/pos",
      }),
    ]);

    expect(rollup.surfacesReached).toEqual([
      { surfaceKey: "pos.checkout", visitors: 3, views: 3 },
      { surfaceKey: "reports", visitors: 1, views: 1 },
    ]);
  });

  it("measures exploration depth as distinct surfaces per visitor", () => {
    const rollup = foldSharedDemoActivity([
      event("shared_demo.surface_viewed", "visitor_a", {
        surfaceKey: "reports",
        routeTemplate: "/reports",
      }),
      event("shared_demo.surface_viewed", "visitor_a", {
        surfaceKey: "reports",
        routeTemplate: "/reports",
      }),
      event("shared_demo.surface_viewed", "visitor_b", {
        surfaceKey: "reports",
        routeTemplate: "/reports",
      }),
      event("shared_demo.surface_viewed", "visitor_b", {
        surfaceKey: "pos.checkout",
        routeTemplate: "/pos",
      }),
      event("shared_demo.surface_viewed", "visitor_b", {
        surfaceKey: "daily_operations",
        routeTemplate: "/ops",
      }),
    ]);

    // visitor_a saw one surface twice; visitor_b saw three distinct surfaces.
    expect(rollup.explorationDepth).toEqual({ median: 2, max: 3 });
  });

  it("separates visitors who completed an action from visitors who only looked", () => {
    const rollup = foldSharedDemoActivity([
      event("shared_demo.surface_viewed", "visitor_looker", {
        surfaceKey: "pos.checkout",
        routeTemplate: "/pos",
      }),
      event("shared_demo.surface_viewed", "visitor_doer", {
        surfaceKey: "pos.checkout",
        routeTemplate: "/pos",
      }),
      event("shared_demo.action_admitted", "visitor_doer", {
        operationId: "pos/public/transactions.completeTransaction",
        capability: "pos.sale.complete",
      }),
    ]);

    expect(rollup.visitorsWhoActed).toBe(1);
    expect(rollup.visitorsWhoOnlyLooked).toBe(1);
    expect(rollup.actionsByCapability).toEqual([
      { capability: "pos.sale.complete", visitors: 1, actions: 1 },
    ]);
    expect(rollup.topOperations).toEqual([
      { operationId: "pos/public/transactions.completeTransaction", actions: 1 },
    ]);
  });

  it("surfaces where visitors hit the demo's edges", () => {
    const rollup = foldSharedDemoActivity([
      event("shared_demo.surface_blocked", "visitor_a", {
        routeTemplate: "/:orgUrlSlug/store/:storeUrlSlug/members",
        reason: "not_visible",
        surfaceKey: "administration.members",
      }),
      event("shared_demo.surface_blocked", "visitor_b", {
        routeTemplate: "/:orgUrlSlug/store/:storeUrlSlug/members",
        reason: "not_visible",
        surfaceKey: "administration.members",
      }),
      event("shared_demo.action_denied", "visitor_a", {
        reason: "demo_policy",
        surfaceKey: "catalog.products",
      }),
    ]);

    expect(rollup.blockedSurfaces).toEqual([
      {
        routeTemplate: "/:orgUrlSlug/store/:storeUrlSlug/members",
        reason: "not_visible",
        visitors: 2,
        hits: 2,
      },
    ]);
    expect(rollup.deniedActions).toEqual([
      { surfaceKey: "catalog.products", visitors: 1, denials: 1 },
    ]);
  });

  it("counts failed restores separately from healthy ones", () => {
    const rollup = foldSharedDemoActivity([
      event("shared_demo.restore_observed", "visitor_a", { phase: "ready", epoch: 4 }),
      event("shared_demo.restore_observed", "visitor_b", { phase: "failed", epoch: 4 }),
      event("shared_demo.restore_observed", "visitor_c", { phase: "failed", epoch: 5 }),
    ]);

    expect(rollup.restoreInterruptions).toBe(2);
  });

  it("reports the observed window from the events themselves", () => {
    const rollup = foldSharedDemoActivity([
      event("shared_demo.session_started", "visitor_a", { entryKind: "fresh" }, {
        occurredAt: start + 5_000,
      }),
      event("shared_demo.session_started", "visitor_b", { entryKind: "fresh" }, {
        occurredAt: start + 1_000,
      }),
    ]);

    expect(rollup.observedFromAt).toBe(start + 1_000);
    expect(rollup.observedToAt).toBe(start + 5_000);
  });
});
