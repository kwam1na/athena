import { describe, expect, it } from "vitest";

import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  buildSharedDemoActivityAppendArgs,
  recordSharedDemoActivity,
  SHARED_DEMO_ACTIVITY_CLOCK_SKEW_MS,
  validateSharedDemoActivity,
} from "./sharedDemoEvents";

const now = 1_760_000_000_000;

function activity(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "shared_demo.surface_viewed" as const,
    idempotencyKey: "shared-demo:9f3c1b7a-1111-2222-3333-444455556666:surface_viewed:pos.checkout",
    occurredAt: now,
    payload: {
      surfaceKey: "pos.checkout",
      routeTemplate: "/:orgUrlSlug/store/:storeUrlSlug/pos",
      presentation: "interactive",
    },
    schemaVersion: 1 as const,
    sessionId: "9f3c1b7a-1111-2222-3333-444455556666",
    viewportBucket: "lg" as const,
    ...overrides,
  };
}

const actor = {
  authUserId: "users_visitor_1",
  organizationId: "organization_demo",
  storeId: "store_demo",
};

describe("shared demo activity validation", () => {
  it("accepts a well-formed session-scoped envelope", () => {
    expect(validateSharedDemoActivity(activity(), now)).toBeNull();
  });

  it("rejects an idempotency key that does not belong to the session", () => {
    expect(
      validateSharedDemoActivity(
        activity({
          idempotencyKey:
            "shared-demo:00000000-0000-0000-0000-000000000000:surface_viewed:pos.checkout",
        }),
        now,
      ),
    ).toBe("Invalid demo activity envelope.");
  });

  it("rejects a session id that is not an opaque token", () => {
    expect(
      validateSharedDemoActivity(
        activity({
          sessionId: "visitor@example.com",
          idempotencyKey: "shared-demo:visitor@example.com:surface_viewed:pos.checkout",
        }),
        now,
      ),
    ).toBe("Invalid demo activity envelope.");
  });

  it("rejects timestamps outside the accepted clock skew", () => {
    expect(
      validateSharedDemoActivity(
        activity({ occurredAt: now - SHARED_DEMO_ACTIVITY_CLOCK_SKEW_MS - 1 }),
        now,
      ),
    ).toBe("Invalid demo activity envelope.");

    expect(
      validateSharedDemoActivity(
        activity({ occurredAt: now + SHARED_DEMO_ACTIVITY_CLOCK_SKEW_MS - 1 }),
        now,
      ),
    ).toBeNull();
  });
});

describe("shared demo activity append args", () => {
  it("identifies the visitor by the server-derived auth user, never the client session", () => {
    const args = buildSharedDemoActivityAppendArgs(activity(), actor);

    // Every demo visitor shares one athenaUser, so the per-visitor join key
    // has to be the auth user the server resolved from the demo principal.
    expect(args.actorRef).toEqual({ kind: "guest", id: "users_visitor_1" });
    expect(args.sessionRef).toEqual({
      kind: "shared_demo_session",
      id: "9f3c1b7a-1111-2222-3333-444455556666",
    });
  });

  it("scopes the event to the demo store and keeps it out of intelligence bundles", () => {
    const args = buildSharedDemoActivityAppendArgs(activity(), actor);

    expect(args.storeId).toBe("store_demo");
    expect(args.organizationId).toBe("organization_demo");
    expect(args.surface).toBe("shared_demo");
    expect(args.nonCompilable).toBe(true);
    expect(args.visibilityMode).toBe("support");
  });

  it("namespaces the idempotency key by the server-resolved visitor", () => {
    // Idempotency uniqueness is scoped to storeId + surface + key. Without the
    // visitor prefix, a browser that guessed another visitor's session id could
    // pre-claim their keys and have their real events dropped as duplicates.
    const mine = buildSharedDemoActivityAppendArgs(activity(), actor);
    const theirs = buildSharedDemoActivityAppendArgs(activity(), {
      ...actor,
      authUserId: "users_visitor_2",
    });

    expect(mine.idempotencyKey).toContain("users_visitor_1");
    expect(mine.idempotencyKey).not.toBe(theirs.idempotencyKey);
  });

  it("partitions the write quota per visitor, not per store", () => {
    const args = buildSharedDemoActivityAppendArgs(activity(), actor);
    const otherVisitor = buildSharedDemoActivityAppendArgs(activity(), {
      ...actor,
      authUserId: "users_visitor_2",
    });

    expect(args.abusePartitionKey).toBe("shared-demo:users_visitor_1");
    expect(otherVisitor.abusePartitionKey).toBe("shared-demo:users_visitor_2");
  });

  it("carries the viewport bucket so device shape is visible without a user agent", () => {
    expect(buildSharedDemoActivityAppendArgs(activity(), actor).environment).toEqual({
      viewportBucket: "lg",
    });
  });

  it("keeps every activity outcome inside the public return contract", () => {
    assertConformsToExportedReturns(recordSharedDemoActivity, {
      kind: "recorded",
      status: "recorded",
    });
    assertConformsToExportedReturns(recordSharedDemoActivity, {
      kind: "duplicate",
      status: "recorded",
    });
    assertConformsToExportedReturns(recordSharedDemoActivity, {
      kind: "rejected",
      message: "No active demo session.",
    });
    assertConformsToExportedReturns(recordSharedDemoActivity, {
      kind: "idempotency_conflict",
      status: "recorded",
      message:
        "Context event idempotency key already exists with different content.",
    });
  });
});
