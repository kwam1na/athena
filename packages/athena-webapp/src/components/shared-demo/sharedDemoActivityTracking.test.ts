import { describe, expect, it } from "vitest";

import {
  buildSharedDemoDenialObservation,
  buildSharedDemoRestoreObservation,
  buildSharedDemoSessionStart,
  buildSharedDemoSurfaceObservation,
  createSharedDemoObservationLedger,
  getOrCreateSharedDemoVisitorSession,
  getSharedDemoViewportBucket,
} from "./sharedDemoActivityTracking";

const sessionId = "9f3c1b7a-1111-2222-3333-444455556666";
const occurredAt = 1_760_000_000_000;

function storage(initial: Record<string, string> = {}) {
  const values = { ...initial };
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value;
    },
  };
}

describe("shared demo visitor session", () => {
  it("mints one opaque session id and reuses it", () => {
    const store = storage();
    const first = getOrCreateSharedDemoVisitorSession(store, () => sessionId);
    const second = getOrCreateSharedDemoVisitorSession(store, () => "other-id");

    expect(first).toBe(sessionId);
    expect(second).toBe(sessionId);
  });

  it("buckets the viewport without recording exact dimensions", () => {
    expect(getSharedDemoViewportBucket(390)).toBe("sm");
    expect(getSharedDemoViewportBucket(800)).toBe("md");
    expect(getSharedDemoViewportBucket(1100)).toBe("lg");
    expect(getSharedDemoViewportBucket(1600)).toBe("xl");
    expect(getSharedDemoViewportBucket(0)).toBe("unknown");
  });
});

describe("shared demo surface observation", () => {
  const input = {
    occurredAt,
    pathname: "/demo/store/central/pos",
    sessionId,
    viewportBucket: "lg" as const,
  };

  it("reports the route template rather than the visited pathname", () => {
    const observation = buildSharedDemoSurfaceObservation(input);

    expect(observation).toEqual({
      eventId: "shared_demo.surface_viewed",
      idempotencyKey: `shared-demo:${sessionId}:surface_viewed:pos.checkout`,
      occurredAt,
      payload: {
        surfaceKey: "pos.checkout",
        routeTemplate: "/:orgUrlSlug/store/:storeUrlSlug/pos",
        presentation: "interactive",
      },
      schemaVersion: 1,
      sessionId,
      viewportBucket: "lg",
    });
  });

  it("never leaks the slugs from the visited path into the payload", () => {
    const payload = JSON.stringify(
      buildSharedDemoSurfaceObservation({
        ...input,
        pathname: "/acme-wigs/store/east-legon/products/lace-front-24/edit",
      })?.payload,
    );

    expect(payload).not.toContain("acme-wigs");
    expect(payload).not.toContain("east-legon");
    expect(payload).not.toContain("lace-front-24");
  });

  it("reports a surface the demo hides as blocked, not as viewed", () => {
    const observation = buildSharedDemoSurfaceObservation({
      ...input,
      pathname: "/demo/store/central/members",
    });

    expect(observation).toMatchObject({
      eventId: "shared_demo.surface_blocked",
      payload: {
        routeTemplate: "/:orgUrlSlug/store/:storeUrlSlug/members",
        reason: "not_visible",
        surfaceKey: "administration.members",
      },
    });
  });

  it("reports an uncataloged path as an unknown route with no surface key", () => {
    const observation = buildSharedDemoSurfaceObservation({
      ...input,
      pathname: "/demo/store/central/not-a-real-surface",
    });

    expect(observation).toMatchObject({
      eventId: "shared_demo.surface_blocked",
      payload: { reason: "unknown_route" },
    });
    expect(observation?.payload).not.toHaveProperty("surfaceKey");
  });
});

describe("shared demo observation ledger", () => {
  it("reports each surface once per session and lets other surfaces through", () => {
    const ledger = createSharedDemoObservationLedger();
    const pos = buildSharedDemoSurfaceObservation({
      occurredAt,
      pathname: "/demo/store/central/pos",
      sessionId,
      viewportBucket: "lg",
    })!;
    const reports = buildSharedDemoSurfaceObservation({
      occurredAt,
      pathname: "/demo/store/central/reports",
      sessionId,
      viewportBucket: "lg",
    })!;

    expect(ledger.shouldReport(pos)).toBe(true);
    expect(ledger.shouldReport(pos)).toBe(false);
    expect(ledger.shouldReport(reports)).toBe(true);
  });
});

describe("other shared demo observations", () => {
  it("marks a returning visitor's session as resumed", () => {
    expect(
      buildSharedDemoSessionStart({
        baselineVersion: 30,
        isNewSession: false,
        occurredAt,
        restoreEpoch: 4,
        sessionId,
        viewportBucket: "md",
      }),
    ).toMatchObject({
      eventId: "shared_demo.session_started",
      idempotencyKey: `shared-demo:${sessionId}:session_started:resumed`,
      payload: { entryKind: "resumed", baselineVersion: 30, restoreEpoch: 4 },
    });
  });

  it("keys a restore observation per epoch so each interruption is counted", () => {
    expect(
      buildSharedDemoRestoreObservation({
        epoch: 7,
        occurredAt,
        phase: "failed",
        sessionId,
        viewportBucket: "md",
      }),
    ).toMatchObject({
      eventId: "shared_demo.restore_observed",
      idempotencyKey: `shared-demo:${sessionId}:restore_observed:failed:7`,
      payload: { phase: "failed", epoch: 7 },
    });
  });

  it("attributes a denial to the surface the visitor was on", () => {
    const observation = buildSharedDemoDenialObservation({
      denialSequence: 3,
      occurredAt,
      pathname: "/demo/store/central/products/lace-front-24/edit",
      sessionId,
      viewportBucket: "md",
    });

    expect(observation).toMatchObject({
      eventId: "shared_demo.action_denied",
      payload: {
        // The browser sees only that the demo refused; the server error
        // carries no capability or admission reason.
        reason: "demo_policy",
        surfaceKey: "catalog.product_edit",
        routeTemplate:
          "/:orgUrlSlug/store/:storeUrlSlug/products/:productSlug/edit",
      },
    });
    expect(observation.idempotencyKey).toBe(
      `shared-demo:${sessionId}:action_denied:3`,
    );
  });
});
