import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import { buildStorefrontObservabilityReport } from "./storefrontObservabilityReport";

type AnalyticsDoc = Doc<"analytics">;

function createAnalyticsEvent(
  overrides: Partial<AnalyticsDoc> & {
    data?: Record<string, unknown>;
  } = {}
): AnalyticsDoc {
  const { data, ...restOverrides } = overrides;
  const baseEvent: AnalyticsDoc = {
    _id: "analytics_1" as Id<"analytics">,
    _creationTime: 1,
    action: "storefront_observability",
    data: {},
    origin: "homepage",
    storeFrontUserId: "guest_1" as Id<"guest">,
    storeId: "store_1" as Id<"store">,
  };

  return {
    ...baseEvent,
    ...restOverrides,
    data: {
      ...(data ?? {}),
    },
  };
}

describe("buildStorefrontObservabilityReport", () => {
  it("groups new storefront observability events by journey, step, and status", () => {
    const report = buildStorefrontObservabilityReport([
      createAnalyticsEvent({
        _id: "analytics_1" as Id<"analytics">,
        _creationTime: 100,
        data: {
          journey: "checkout",
          step: "payment_submission",
          status: "started",
          sessionId: "session-a",
        },
      }),
      createAnalyticsEvent({
        _id: "analytics_2" as Id<"analytics">,
        _creationTime: 200,
        data: {
          journey: "checkout",
          step: "payment_submission",
          status: "failed",
          sessionId: "session-a",
          errorCategory: "network",
        },
      }),
      createAnalyticsEvent({
        _id: "analytics_3" as Id<"analytics">,
        _creationTime: 300,
        data: {
          journey: "checkout",
          step: "payment_submission",
          status: "succeeded",
          sessionId: "session-b",
        },
      }),
      createAnalyticsEvent({
        _id: "analytics_4" as Id<"analytics">,
        _creationTime: 400,
        data: {
          journey: "bag",
          step: "bag_view",
          status: "viewed",
          sessionId: "session-c",
        },
      }),
      createAnalyticsEvent({
        _id: "analytics_legacy" as Id<"analytics">,
        _creationTime: 500,
        action: "viewed_product",
      }),
    ]);

    expect(report.summary.totalEvents).toBe(4);
    expect(report.summary.totalFailures).toBe(1);
    expect(report.summary.uniqueSessions).toBe(3);

    expect(report.funnel).toEqual([
      {
        journey: "bag",
        step: "bag_view",
        status: "viewed",
        count: 1,
        uniqueSessions: 1,
        latestEventTime: 400,
      },
      {
        journey: "checkout",
        step: "payment_submission",
        status: "failed",
        count: 1,
        uniqueSessions: 1,
        latestEventTime: 200,
      },
      {
        journey: "checkout",
        step: "payment_submission",
        status: "started",
        count: 1,
        uniqueSessions: 1,
        latestEventTime: 100,
      },
      {
        journey: "checkout",
        step: "payment_submission",
        status: "succeeded",
        count: 1,
        uniqueSessions: 1,
        latestEventTime: 300,
      },
    ]);
  });

  it("builds failure clusters by normalized error category and correlated session id", () => {
    const report = buildStorefrontObservabilityReport([
      createAnalyticsEvent({
        _id: "analytics_failure_1" as Id<"analytics">,
        _creationTime: 100,
        data: {
          journey: "checkout",
          step: "payment_submission",
          status: "failed",
          sessionId: "session-a",
          errorCategory: "network",
          errorCode: "timeout",
          errorMessage: "Request timed out",
          route: "/checkout",
        },
      }),
      createAnalyticsEvent({
        _id: "analytics_failure_2" as Id<"analytics">,
        _creationTime: 200,
        data: {
          journey: "checkout",
          step: "payment_submission",
          status: "failed",
          sessionId: "session-b",
          errorCategory: "network",
          errorCode: "timeout",
          route: "/checkout",
        },
      }),
      createAnalyticsEvent({
        _id: "analytics_failure_3" as Id<"analytics">,
        _creationTime: 300,
        data: {
          journey: "auth",
          step: "auth_verification",
          status: "failed",
          sessionId: "session-c",
          route: "/checkout/login",
        },
      }),
    ]);

    expect(report.failureClusters).toEqual([
      {
        errorCategory: "network",
        count: 2,
        uniqueSessions: 2,
        latestEventTime: 200,
        sessions: ["session-a", "session-b"],
        sample: {
          journey: "checkout",
          step: "payment_submission",
          route: "/checkout",
          errorCode: "timeout",
          errorMessage: "Request timed out",
        },
      },
      {
        errorCategory: "unknown",
        count: 1,
        uniqueSessions: 1,
        latestEventTime: 300,
        sessions: ["session-c"],
        sample: {
          journey: "auth",
          step: "auth_verification",
          route: "/checkout/login",
          errorCode: undefined,
          errorMessage: undefined,
        },
      },
    ]);
  });
});
