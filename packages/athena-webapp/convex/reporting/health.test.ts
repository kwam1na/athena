import { describe, expect, it } from "vitest";

import {
  mergeProjectionHealthState,
  presentProjectionHealthRow,
  REPORTING_FRESHNESS_TARGET_MS,
  summarizeProjectionHealthRead,
  summarizeReportingHealth,
} from "./health";

describe("reporting projection health", () => {
  it("marks current complete generations healthy", () => {
    expect(
      summarizeReportingHealth({
        activated: true,
        failedRunCount: 0,
        latestAcceptedSourceAt: 100,
        latestProjectedSourceAt: 100,
        now: 200,
        projectionUpdatedAt: 150,
        quarantineCount: 0,
        requiredCoverageComplete: true,
      }),
    ).toMatchObject({ freshness: "current", status: "healthy" });
  });

  it("distinguishes pre-cutover, partial, failed, and stale states", () => {
    expect(
      summarizeReportingHealth({
        activated: false,
        failedRunCount: 0,
        latestAcceptedSourceAt: 0,
        latestProjectedSourceAt: 0,
        now: 0,
        projectionUpdatedAt: null,
        quarantineCount: 0,
        requiredCoverageComplete: false,
      }).status,
    ).toBe("pre_cutover");

    expect(
      summarizeReportingHealth({
        activated: true,
        failedRunCount: 0,
        latestAcceptedSourceAt: 100,
        latestProjectedSourceAt: 100,
        now: 200,
        projectionUpdatedAt: 150,
        quarantineCount: 1,
        requiredCoverageComplete: false,
      }).status,
    ).toBe("partial");

    expect(
      summarizeReportingHealth({
        activated: true,
        failedRunCount: 1,
        latestAcceptedSourceAt: 100,
        latestProjectedSourceAt: 50,
        now: 10 * 60_000,
        projectionUpdatedAt: 0,
        quarantineCount: 0,
        requiredCoverageComplete: true,
      }).status,
    ).toBe("failed");
  });

  it("preserves the last verified active generation during candidate failure", () => {
    expect(
      mergeProjectionHealthState(
        {
          activeGenerationId: "generation-active",
          latestSuccessfulReconciliationAt: 100,
        },
        {
          activeGenerationId: undefined,
          latestSuccessfulReconciliationAt: undefined,
          limitingReason: "processing_failed",
        },
      ),
    ).toMatchObject({
      activeGenerationId: "generation-active",
      latestSuccessfulReconciliationAt: 100,
      limitingReason: "processing_failed",
    });
  });

  it("ages an otherwise healthy persisted row to stale at read time", () => {
    expect(
      presentProjectionHealthRow({
        activity: {
          latestProcessedAcceptedAt: 100,
          oldestPendingAcceptedAt: null,
          sourceDomain: "pos",
        },
        now: REPORTING_FRESHNESS_TARGET_MS + 1_000,
        row: {
          processingWatermark: 100,
          quarantinedCount: 0,
          sourceDomain: "pos",
          updatedAt: 999,
        },
      }),
    ).toMatchObject({
      freshnessStatus: "stale",
      limitingReason: "projection_stale",
      status: "stale",
      unprojectedAcceptedAt: null,
    });
  });

  it("detects pending and processed ingress ahead of the projection watermark", () => {
    expect(
      presentProjectionHealthRow({
        activity: {
          latestProcessedAcceptedAt: 800,
          oldestPendingAcceptedAt: 500,
          sourceDomain: "storefront",
        },
        now: REPORTING_FRESHNESS_TARGET_MS + 501,
        row: {
          processingWatermark: 700,
          quarantinedCount: 0,
          sourceDomain: "storefront",
          updatedAt: REPORTING_FRESHNESS_TARGET_MS + 500,
        },
      }),
    ).toMatchObject({
      freshnessStatus: "stale",
      limitingReason: "processing_delayed",
      status: "stale",
      unprojectedAcceptedAt: 500,
    });

    expect(
      presentProjectionHealthRow({
        activity: {
          latestProcessedAcceptedAt: 800,
          oldestPendingAcceptedAt: null,
          sourceDomain: "storefront",
        },
        now: 1_000,
        row: {
          processingWatermark: 700,
          quarantinedCount: 0,
          sourceDomain: "storefront",
          updatedAt: 900,
        },
      }),
    ).toMatchObject({ status: "processing", unprojectedAcceptedAt: 800 });
  });

  it("surfaces durable projection worker failures as partial health", () => {
    expect(
      presentProjectionHealthRow({
        activity: {
          failedProjectionAt: 500,
          latestProcessedAcceptedAt: 500,
          oldestPendingAcceptedAt: 500,
          sourceDomain: "inventory",
        },
        now: 1_000,
        row: {
          processingWatermark: 400,
          quarantinedCount: 0,
          sourceDomain: "inventory",
          updatedAt: 900,
        },
      }),
    ).toMatchObject({
      limitingReason: "processing_failed",
      status: "partial",
      unprojectedAcceptedAt: 500,
    });
  });

  it("surfaces bounded source activity even before a health row exists", () => {
    expect(
      summarizeProjectionHealthRead({
        activity: [
          {
            latestProcessedAcceptedAt: null,
            oldestPendingAcceptedAt: 1,
            sourceDomain: "payments",
          },
        ],
        now: REPORTING_FRESHNESS_TARGET_MS + 2,
        rows: [],
      }),
    ).toMatchObject({
      status: "stale",
      unprojectedSources: [
        {
          acceptedAt: 1,
          sourceDomain: "payments",
        },
      ],
    });
  });
});
