import { describe, expect, it } from "vitest";

import {
  buildStoreInsightsContextBundleFromContextEvents,
  buildUserInsightsContextBundleFromContextEvents,
} from "./contextBundles";

type ContextEventRow = Parameters<
  typeof buildStoreInsightsContextBundleFromContextEvents
>[0][number];

function contextEvent(
  overrides: Partial<ContextEventRow> = {},
): ContextEventRow {
  return {
    _id: "context_event_1" as ContextEventRow["_id"],
    _creationTime: 1_700_000_000_000,
    storeId: "store_1" as ContextEventRow["storeId"],
    organizationId: "org_1" as ContextEventRow["organizationId"],
    surface: "storefront",
    eventId: "storefront.product_viewed",
    schemaVersion: 1,
    idempotencyKey: "key_1",
    envelopeHash: "envelope_hash",
    payloadHash: "payload_hash",
    occurredAt: 1_700_000_000_000,
    receivedAt: 1_700_000_000_100,
    origin: "web",
    status: "recorded",
    nonCompilable: false,
    payload: {
      productId: "product_1",
      categorySlug: "wigs",
    },
    actorRef: { kind: "guest", id: "guest_1" },
    sessionRefKind: "storefront_session",
    sessionRefId: "session_1",
    primarySubjectType: "product",
    primarySubjectId: "product_1",
    subjectRefs: [{ type: "product", id: "product_1" }],
    sourceRefs: [],
    visibilityMode: "store_admin",
    retentionClass: "standard",
    environment: {
      deviceClass: "mobile",
      browserFamily: "safari",
      osFamily: "ios",
      viewportBucket: "sm",
    },
    synthetic: false,
    ...overrides,
  };
}

describe("contextEvent storefront bundle compilation", () => {
  it("builds store bundles from recorded contextEvent rows only", () => {
    const bundle = buildStoreInsightsContextBundleFromContextEvents([
      contextEvent({
        _id: "context_event_valid" as ContextEventRow["_id"],
        occurredAt: 1_700_000_000_100,
      }),
      contextEvent({
        _id: "context_event_synthetic" as ContextEventRow["_id"],
        synthetic: true,
      }),
      contextEvent({
        _id: "context_event_rejected" as ContextEventRow["_id"],
        status: "rejected",
      }),
    ]);

    expect(bundle).toMatchObject({
      bundleKind: "store_insights_context",
      freshness: "current",
      dataWindowStartAt: 1_700_000_000_100,
      dataWindowEndAt: 1_700_000_000_100,
      hiddenSourceCount: 2,
      omittedEvidenceCount: 2,
      limitedEvidence: false,
    });
    expect(bundle.qualityFlags).toContain("context_events_compiled");
    expect(bundle.qualityFlags).toContain("context_events_omitted");
    expect(bundle.sourceRefs).toEqual([
      {
        table: "contextEvent",
        id: "context_event_valid",
        label: "storefront.product_viewed",
      },
    ]);
    expect(readCompactEvents(bundle)).toMatchObject([
      {
        id: "context_event_valid",
        eventId: "storefront.product_viewed",
        contextSchemaVersion: 1,
        environment: {
          deviceClass: "mobile",
          browserFamily: "safari",
          osFamily: "ios",
          viewportBucket: "sm",
        },
        payload: { productId: "product_1", categorySlug: "wigs" },
      },
    ]);
  });

  it("uses context-event environment metadata for device distribution", () => {
    const bundle = buildStoreInsightsContextBundleFromContextEvents([
      contextEvent({
        _id: "context_event_mobile" as ContextEventRow["_id"],
        environment: {
          deviceClass: "mobile",
          browserFamily: "safari",
          osFamily: "ios",
          viewportBucket: "sm",
        },
      }),
      contextEvent({
        _id: "context_event_desktop" as ContextEventRow["_id"],
        environment: {
          deviceClass: "desktop",
          browserFamily: "chrome",
          osFamily: "macos",
          viewportBucket: "xl",
        },
      }),
      contextEvent({
        _id: "context_event_tablet" as ContextEventRow["_id"],
        environment: {
          deviceClass: "tablet",
          browserFamily: "safari",
          osFamily: "ios",
          viewportBucket: "lg",
        },
      }),
      contextEvent({
        _id: "context_event_bot" as ContextEventRow["_id"],
        environment: {
          deviceClass: "bot",
          browserFamily: "other",
          osFamily: "other",
          viewportBucket: "unknown",
        },
      }),
    ]);

    expect(bundle.payloadSummary.deviceDistribution).toMatchObject({
      mobile: "50%",
      desktop: "25%",
      unknown: "25%",
    });
    expect(readCompactEvents(bundle)).toMatchObject([
      {
        environment: {
          deviceClass: "mobile",
          browserFamily: "safari",
          osFamily: "ios",
          viewportBucket: "sm",
        },
      },
      {
        environment: {
          deviceClass: "desktop",
          browserFamily: "chrome",
          osFamily: "macos",
          viewportBucket: "xl",
        },
      },
      {
        environment: {
          deviceClass: "tablet",
          browserFamily: "safari",
          osFamily: "ios",
          viewportBucket: "lg",
        },
      },
      {
        environment: {
          deviceClass: "bot",
          browserFamily: "other",
          osFamily: "other",
          viewportBucket: "unknown",
        },
      },
    ]);
  });

  it("keeps user actor source refs separate from context evidence refs", () => {
    const bundle = buildUserInsightsContextBundleFromContextEvents(
      [
        contextEvent({
          _id: "context_event_user" as ContextEventRow["_id"],
          eventId: "storefront.cart_changed",
          payload: {
            productId: "product_1",
            quantity: 2,
            change: "added",
          },
          actorRef: { kind: "guest", id: "guest_1" },
        }),
      ],
      { table: "guest", id: "guest_1" },
    );

    expect(bundle.sourceRefs).toEqual([
      { table: "guest", id: "guest_1" },
      {
        table: "contextEvent",
        id: "context_event_user",
        label: "storefront.cart_changed",
      },
    ]);
    expect(bundle.hiddenSourceCount).toBe(0);
    expect(readCompactEvents(bundle)).toMatchObject([
      {
        eventId: "storefront.cart_changed",
        payload: { productId: "product_1", quantity: 2, change: "added" },
      },
    ]);
  });

  it("includes imported historical context through contextEvent rows", () => {
    const bundle = buildStoreInsightsContextBundleFromContextEvents([
      contextEvent({
        _id: "context_event_imported" as ContextEventRow["_id"],
        historicalImportRunId: "import_1",
        historicalImportStatus: "active",
        sourceRefs: [
          {
            table: "analytics",
            id: "analytics_1",
            label: "storefront.product_viewed",
          },
        ],
      }),
    ]);

    expect(bundle.sourceRefs[0]).toMatchObject({
      table: "contextEvent",
      id: "context_event_imported",
    });
    expect(bundle.qualityFlags).toContain("historical_context_included");
  });

  it("excludes quarantined historical import batches", () => {
    const bundle = buildStoreInsightsContextBundleFromContextEvents([
      contextEvent({
        historicalImportRunId: "import_1",
        historicalImportStatus: "quarantined",
      }),
    ]);

    expect(bundle).toMatchObject({
      freshness: "partial",
      limitedEvidence: true,
      omittedEvidenceCount: 1,
    });
    expect(bundle.sourceRefs).toEqual([]);
    expect(readCompactEvents(bundle)).toEqual([]);
  });

  it("omits unsafe payload keys and raw text from prompt snapshots", () => {
    const bundle = buildStoreInsightsContextBundleFromContextEvents([
      contextEvent({
        payload: {
          productId: "product_1",
          rawUrl: "https://wigclub.store/?token=secret",
          userAgent: "Mozilla/5.0",
          note: "customer@example.com",
          categorySlug: "wigs",
        },
      }),
    ]);

    const serialized = JSON.stringify(bundle.payloadSummary);
    expect(serialized).toContain("product_1");
    expect(serialized).toContain("wigs");
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("Mozilla");
    expect(serialized).not.toContain("customer@example.com");
  });

  it("marks bundles partial when no context events can be compiled", () => {
    const bundle = buildStoreInsightsContextBundleFromContextEvents([
      contextEvent({ nonCompilable: true }),
    ]);

    expect(bundle).toMatchObject({
      freshness: "partial",
      hiddenSourceCount: 1,
      omittedEvidenceCount: 1,
      limitedEvidence: true,
    });
    expect(bundle.qualityFlags).toContain("no_storefront_context");
    expect(bundle.qualityFlags).toContain("context_events_omitted");
  });
});

function readCompactEvents(bundle: { payloadSummary: Record<string, unknown> }) {
  return bundle.payloadSummary.compactContextEvents;
}
