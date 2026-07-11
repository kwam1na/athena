import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  advanceHistoricalBackfillCursor,
  assertHistoricalBackfillPreviewCompatible,
  classifyHistoricalCommerce,
  classifyHistoricalSourceSize,
  decodeHistoricalBackfillCursor,
  encodeHistoricalBackfillCursor,
  fingerprintHistoricalPlannedFact,
  fingerprintPersistedHistoricalFact,
  historicalBackfillAuditForOutcome,
  historicalBackfillCoverageBasisPoints,
  historicalManifestCandidateJson,
  historicalManifestEntryDigest,
  historicalFactMatchesExistingCanonical,
  historicalPolicyExcludesClosedFact,
  historicalPosCommerceLine,
  HISTORICAL_BACKFILL_SCANNED_SOURCE_DOMAINS,
  mergeHistoricalBackfillAuditCounts,
  normalizeHistoricalFactWithPolicy,
  EMPTY_HISTORICAL_BACKFILL_AUDIT,
  planPaymentAllocationFact,
  planHistoricalProcurementFacts,
  planHistoricalReversalFacts,
  parseHistoricalManifestCandidate,
  recordHistoricalInterpretationEvidenceWithCtx,
  reconcileHistoricalBackfillCounts,
} from "./backfill";
import { deriveFactMetricContributions } from "../projections/factContributions";

describe("reporting historical backfill", () => {
  const approvedPolicy = {
    _id: "policy-1",
    approvalHash: "approval-hash-1",
    contentHash: "content-hash-1",
    intervalEnd: 1_000,
    intervalStart: 0,
    revenueCurrencyCode: "GHS",
    status: "approved",
  } as never;

  it("excludes approved closed-day history without treating missing periods as policy exclusions", () => {
    const sundayAtNoon = Date.UTC(2026, 6, 5, 12);
    const policy = {
      _id: "policy-closed-sunday",
      approvalHash: "approval-hash-closed-sunday",
      contentHash: "content-hash-closed-sunday",
      dateExceptionsJson: "[]",
      intervalEnd: Date.UTC(2026, 6, 10),
      intervalStart: Date.UTC(2026, 6, 1),
      organizationId: "org-1",
      status: "approved",
      storeId: "store-1",
      timezone: "Africa/Accra",
      weeklyWindowsJson: JSON.stringify(
        [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          endMinute: 23 * 60,
          startMinute: 9 * 60,
        })),
      ),
    } as never;

    expect(
      historicalPolicyExcludesClosedFact({
        fact: { occurredAt: sundayAtNoon },
        policy,
      }),
    ).toBe(true);
    expect(
      historicalPolicyExcludesClosedFact({
        fact: { occurredAt: sundayAtNoon },
        policy: null,
      }),
    ).toBe(false);
    expect(
      historicalPolicyExcludesClosedFact({
        fact: { occurredAt: Date.UTC(2026, 6, 4, 12) },
        policy,
      }),
    ).toBe(false);
  });

  it("seals immutable candidate semantics independently of later source mutation", () => {
    const sourceFact = {
      amountMinor: 5_000,
      businessEventKey: "pos:tx-1:complete:line-1",
      completeness: "partial" as const,
      costStatus: "unknown" as const,
      currency: "GHS",
      factType: "sale" as const,
      occurredAt: 100,
      sourceDomain: "pos" as const,
      sourceId: "tx-1",
      sourceType: "pos_transaction",
    };
    const sealedPeriod = {
      historicalInterpretationPolicyHash: "approval-hash-1",
      historicalInterpretationPolicyId: "policy-1",
      operatingDate: "2026-06-29",
    };
    const snapshot = historicalManifestCandidateJson(sourceFact, sealedPeriod);
    const digest = historicalManifestEntryDigest("historical-manifest-v1:empty", {
      businessEventKey: sourceFact.businessEventKey,
      candidateFingerprint: "fingerprint-1",
      inferredFields: ["currency"],
      originallyMissingFields: ["currency"],
      outcome: "created",
      sanitizedCandidateJson: snapshot,
      sequence: 1,
      sourceDomain: "pos",
    });

    sourceFact.amountMinor = 9_999;

    const candidate = parseHistoricalManifestCandidate(snapshot);
    expect(candidate.fact.amountMinor).toBe(5_000);
    expect(candidate.resolvedPeriod).toEqual(sealedPeriod);
    expect(digest).toBe(
      historicalManifestEntryDigest("historical-manifest-v1:empty", {
        businessEventKey: sourceFact.businessEventKey,
        candidateFingerprint: "fingerprint-1",
        inferredFields: ["currency"],
        originallyMissingFields: ["currency"],
        outcome: "created",
        sanitizedCandidateJson: snapshot,
        sequence: 1,
        sourceDomain: "pos",
      }),
    );
  });

  it("keeps sealed period lineage after current schedule resolution changes", () => {
    const fact = {
      amountMinor: 5_000,
      businessEventKey: "pos:tx-1:complete:line-1",
      completeness: "complete" as const,
      costStatus: "not_applicable" as const,
      currency: "GHS",
      factType: "sale" as const,
      occurredAt: 100,
      sourceDomain: "pos" as const,
      sourceId: "tx-1",
      sourceType: "pos_transaction",
    };
    const snapshot = historicalManifestCandidateJson(fact, {
      historicalInterpretationPolicyHash: "approval-hash-1",
      historicalInterpretationPolicyId: "policy-1",
      operatingDate: "2026-06-29",
    });
    const laterScheduleResolution = {
      operatingDate: "2026-06-30",
      scheduleVersionId: "schedule-added-after-seal",
    };

    expect(parseHistoricalManifestCandidate(snapshot).resolvedPeriod).toEqual({
      historicalInterpretationPolicyHash: "approval-hash-1",
      historicalInterpretationPolicyId: "policy-1",
      operatingDate: "2026-06-29",
    });
    expect(parseHistoricalManifestCandidate(snapshot).resolvedPeriod).not.toEqual(
      laterScheduleResolution,
    );
  });

  it("rejects a tampered manifest period with mixed lineage", () => {
    expect(() =>
      parseHistoricalManifestCandidate(
        historicalManifestCandidateJson(
          {
            businessEventKey: "pos:tx-1:complete:line-1",
            completeness: "complete",
            costStatus: "not_applicable",
            currency: "GHS",
            factType: "sale",
            occurredAt: 100,
            sourceDomain: "pos",
            sourceId: "tx-1",
            sourceType: "pos_transaction",
          },
          {
            historicalInterpretationPolicyHash: "approval-hash-1",
            historicalInterpretationPolicyId: "policy-1",
            operatingDate: "2026-06-29",
            scheduleVersionId: "tampered-schedule",
          },
        ),
      ),
    ).toThrow("Reporting period lineage requires exactly one source");
  });

  it("makes manifest digests order-sensitive and tamper-evident", () => {
    const item = {
      businessEventKey: "expense:e-1:posted",
      candidateFingerprint: "fingerprint-1",
      inferredFields: ["currency"],
      originallyMissingFields: ["currency"],
      outcome: "created" as const,
      sanitizedCandidateJson: JSON.stringify({
        sourceDomain: "payments",
        sourceId: "e-1",
        sourceType: "expense_transaction",
      }),
      sequence: 1,
      sourceDomain: "payments" as const,
    };
    const digest = historicalManifestEntryDigest("seed", item);
    expect(
      historicalManifestEntryDigest("seed", { ...item, sequence: 2 }),
    ).not.toBe(digest);
    expect(
      historicalManifestEntryDigest("seed", {
        ...item,
        sanitizedCandidateJson: `${item.sanitizedCandidateJson} `,
      }),
    ).not.toBe(digest);
  });

  it("infers only approved missing revenue currency and records original absence", () => {
    const normalized = normalizeHistoricalFactWithPolicy({
      fact: {
        amountMinor: 5_000,
        businessEventKey: "payment_allocation:a-1:recorded:payment",
        completeness: "complete",
        costStatus: "not_applicable",
        currency: null,
        factType: "payment",
        occurredAt: 100,
        sourceDomain: "payments",
        sourceId: "a-1",
        sourceType: "payment_allocation",
      },
      policy: approvedPolicy,
    });
    expect(normalized).toMatchObject({
      fact: { currency: "GHS" },
      inferredFields: ["revenueCurrency"],
      originallyMissingFields: ["revenueCurrency"],
    });
  });

  it("does not apply Wigclub currency outside policy or to procurement valuation", () => {
    const outside = normalizeHistoricalFactWithPolicy({
      fact: {
        amountMinor: 5_000,
        businessEventKey: "payment_allocation:a-1:recorded:payment",
        completeness: "complete",
        costStatus: "not_applicable",
        currency: null,
        factType: "payment",
        occurredAt: 1_001,
        sourceDomain: "payments",
        sourceId: "a-1",
        sourceType: "payment_allocation",
      },
      policy: approvedPolicy,
    });
    expect(outside.fact.currency).toBeNull();
    expect(outside.inferredFields).toEqual([]);

    const procurement = normalizeHistoricalFactWithPolicy({
      fact: {
        businessEventKey: "purchase_order:po-1:receipt:r-1",
        cogsKnownMinor: 2_000,
        completeness: "complete",
        costStatus: "known",
        currency: null,
        factType: "procurement_receipt",
        occurredAt: 100,
        sourceDomain: "procurement",
        sourceId: "r-1",
        sourceType: "purchase_order",
      },
      policy: approvedPolicy,
    });
    expect(procurement.fact).toMatchObject({
      completeness: "partial",
      costStatus: "unknown",
      currency: null,
      limitingReason: "uncosted",
    });
    expect(procurement.fact.cogsKnownMinor).toBeUndefined();
    expect(procurement.inferredFields).toEqual([]);
    expect(procurement.originallyMissingFields).toEqual(["valuationCurrency"]);
  });

  it("quarantines missing occurrence, currency, or identity without invention", () => {
    expect(
      classifyHistoricalCommerce({
        currency: null,
        eventKey: null,
        occurredAt: null,
        sourceId: "source-1",
      }),
    ).toEqual({
      reasons: [
        "missing_business_identity",
        "missing_currency",
        "missing_occurrence",
      ],
      status: "quarantined",
    });
  });

  it("accepts complete historical identity while leaving cost classification separate", () => {
    expect(
      classifyHistoricalCommerce({
        currency: "GHS",
        eventKey: "pos:transaction-1:complete",
        occurredAt: 100,
        sourceId: "transaction-1",
      }),
    ).toEqual({ reasons: [], status: "eligible" });
  });

  it("round-trips an opaque page cursor without changing the frozen source phase", () => {
    const encoded = encodeHistoricalBackfillCursor({
      pageCursor: "opaque|cursor:with punctuation",
      phase: "storefront_delivered",
    });

    expect(decodeHistoricalBackfillCursor(encoded)).toEqual({
      pageCursor: "opaque|cursor:with punctuation",
      phase: "storefront_delivered",
    });
  });

  it("advances only after the current source page is exhausted", () => {
    expect(
      advanceHistoricalBackfillCursor({
        continueCursor: "next-page",
        isDone: false,
        phase: "pos",
      }),
    ).toEqual({ pageCursor: "next-page", phase: "pos" });
    expect(
      advanceHistoricalBackfillCursor({
        continueCursor: "ignored",
        isDone: true,
        phase: "pos",
      }),
    ).toEqual({ pageCursor: null, phase: "pos_void" });
  });

  it("preserves quantity-only unknown-cost evidence without requiring currency", () => {
    expect(
      classifyHistoricalCommerce({
        currency: null,
        eventKey: "purchase_order:po-1:receipt:r-1:line:l-1",
        occurredAt: 100,
        requiresCurrency: false,
        sourceId: "r-1",
      }),
    ).toEqual({ reasons: [], status: "eligible" });
  });

  it("marks only fully traversed source domains as historically scanned", () => {
    expect(HISTORICAL_BACKFILL_SCANNED_SOURCE_DOMAINS).toContain("payments");
    expect(HISTORICAL_BACKFILL_SCANNED_SOURCE_DOMAINS).not.toContain(
      "daily_close",
    );
  });

  it("requires every planned fact to reconcile to a durable outcome", () => {
    expect(
      reconcileHistoricalBackfillCounts({
        created: 2,
        excluded: 1,
        existing: 3,
        planned: 7,
        quarantined: 1,
      }),
    ).toBe(7);
    expect(() =>
      reconcileHistoricalBackfillCounts({
        created: 2,
        excluded: 0,
        existing: 0,
        planned: 3,
        quarantined: 0,
      }),
    ).toThrow("Historical backfill count mismatch");
  });

  it("compares existing identities by canonical material fingerprint", () => {
    const planned = {
      amountMinor: 5_000,
      businessEventKey: "pos:tx-1:complete:line:line-1:sale",
      completeness: "partial" as const,
      costStatus: "unknown" as const,
      currency: "ghs",
      factType: "sale" as const,
      occurredAt: 100,
      productSkuId: "sku-1",
      quantity: 1,
      revenueKind: "merchandise" as const,
      sourceDomain: "pos" as const,
      sourceId: "tx-1",
      sourceLineKey: "line-1",
      sourceType: "pos_transaction",
    };
    const period = {
      operatingDate: "2026-07-09",
      scheduleVersionId: "schedule-1",
    };
    const scope = { organizationId: "org-1", storeId: "store-1" };
    const expected = fingerprintHistoricalPlannedFact(planned, period, scope);

    expect(
      fingerprintPersistedHistoricalFact({
        amountMinor: 5_000,
        businessEventKey: planned.businessEventKey,
        completeness: "partial",
        costStatus: "unknown",
        currencyCode: "GHS",
        currencyMinorUnitScale: 2,
        factType: "sale",
        occurrenceAt: 100,
        operatingDate: period.operatingDate,
        organizationId: scope.organizationId,
        productSkuId: "sku-1",
        quantity: 1,
        recognitionAt: 100,
        revenueKind: "merchandise",
        scheduleVersionId: "schedule-1",
        sourceDomain: "pos",
        sourceLineKey: "line-1",
        storeId: scope.storeId,
      } as never),
    ).toBe(expected);
    expect(
      fingerprintPersistedHistoricalFact({
        amountMinor: 4_999,
        businessEventKey: planned.businessEventKey,
        completeness: "partial",
        costStatus: "unknown",
        currencyCode: "GHS",
        currencyMinorUnitScale: 2,
        factType: "sale",
        occurrenceAt: 100,
        operatingDate: period.operatingDate,
        organizationId: scope.organizationId,
        productSkuId: "sku-1",
        quantity: 1,
        scheduleVersionId: "schedule-1",
        sourceDomain: "pos",
        sourceLineKey: "line-1",
        storeId: scope.storeId,
      } as never),
    ).not.toBe(expected);
    expect(
      fingerprintPersistedHistoricalFact({
        amountMinor: 5_000,
        businessEventKey: planned.businessEventKey,
        completeness: "stale",
        costStatus: "unknown",
        currencyCode: "GHS",
        currencyMinorUnitScale: 2,
        factType: "sale",
        occurrenceAt: 100,
        operatingDate: period.operatingDate,
        organizationId: scope.organizationId,
        productSkuId: "sku-1",
        quantity: 1,
        scheduleVersionId: "schedule-1",
        sourceDomain: "pos",
        sourceLineKey: "line-1",
        storeId: scope.storeId,
      } as never),
    ).not.toBe(expected);
  });

  it("accepts a live-covered missing-currency overlap only when known material matches", () => {
    const fact = {
      amountMinor: 5_000,
      businessEventKey: "pos:tx-1:complete:line:line-1:sale",
      completeness: "partial" as const,
      costStatus: "unknown" as const,
      currency: null,
      factType: "sale" as const,
      occurredAt: 100,
      productSkuId: "sku-1",
      quantity: 1,
      revenueKind: "merchandise" as const,
      sourceDomain: "pos" as const,
      sourceId: "tx-1",
      sourceLineKey: "line-1",
      sourceType: "pos_transaction",
    };
    const period = {
      operatingDate: "2026-07-09",
      scheduleVersionId: "schedule-1",
    };
    const scope = { organizationId: "org-1", storeId: "store-1" };
    const existing = {
      amountMinor: 5_000,
      businessEventKey: fact.businessEventKey,
      completeness: "partial",
      costStatus: "unknown",
      currencyCode: "GHS",
      currencyMinorUnitScale: 2,
      factType: "sale",
      occurrenceAt: 100,
      operatingDate: period.operatingDate,
      organizationId: scope.organizationId,
      productSkuId: "sku-1",
      quantity: 1,
      revenueKind: "merchandise",
      scheduleVersionId: period.scheduleVersionId,
      sourceDomain: "pos",
      sourceLineKey: "line-1",
      storeId: scope.storeId,
    };

    expect(
      historicalFactMatchesExistingCanonical({
        existing: existing as never,
        fact,
        period,
        scope,
      }),
    ).toBe(true);
    expect(
      historicalFactMatchesExistingCanonical({
        existing: { ...existing, amountMinor: 4_999 } as never,
        fact,
        period,
        scope,
      }),
    ).toBe(false);
  });

  it("rejects a canonical payment currency that differs from policy-resolved GHS", () => {
    const normalized = normalizeHistoricalFactWithPolicy({
      fact: planPaymentAllocationFact({
        _id: "allocation-1",
        amount: 5_000,
        direction: "in",
        recordedAt: 100,
        status: "recorded",
      } as never)[0]!,
      policy: approvedPolicy,
    }).fact;
    const period = {
      operatingDate: "2026-07-09",
      scheduleVersionId: "schedule-1",
    };
    const scope = { organizationId: "org-1", storeId: "store-1" };
    const existing = {
      amountMinor: 5_000,
      businessEventKey: normalized.businessEventKey,
      completeness: "complete",
      costStatus: "not_applicable",
      currencyCode: "USD",
      currencyMinorUnitScale: 2,
      factType: "payment",
      occurrenceAt: 100,
      operatingDate: period.operatingDate,
      organizationId: scope.organizationId,
      scheduleVersionId: period.scheduleVersionId,
      sourceDomain: "payments",
      storeId: scope.storeId,
    };
    expect(
      historicalFactMatchesExistingCanonical({
        existing: existing as never,
        fact: normalized,
        period,
        scope,
      }),
    ).toBe(false);
  });

  it("matches live and historical commerce on all source-known material", () => {
    const fact = {
      allocatedDiscountMinor: 500,
      amountMinor: 5_000,
      attributionKind: "direct" as const,
      attributionVersion: 1,
      businessEventKey: "pos:tx-1:complete:line:line-1:sale",
      channel: "pos" as const,
      cogsKnownMinor: 2_000,
      completeness: "complete" as const,
      costStatus: "known" as const,
      currency: "GHS",
      factType: "sale" as const,
      occurredAt: 100,
      originalProductSkuId: "sku-1",
      originalQuantity: 2,
      productId: "product-1",
      productSkuId: "sku-1",
      quantity: 2,
      recognizedNetAmountMinor: 5_000,
      recognitionProductSkuId: "sku-1",
      revenueKind: "merchandise" as const,
      sourceDomain: "pos" as const,
      sourceId: "tx-1",
      sourceLineKey: "line-1",
      sourceType: "pos_transaction",
      unitPriceMinor: 2_750,
    };
    const period = {
      operatingDate: "2026-07-09",
      scheduleVersionId: "schedule-1",
    };
    const scope = { organizationId: "org-1", storeId: "store-1" };
    const existing = {
      ...fact,
      currencyCode: fact.currency,
      currencyMinorUnitScale: 2,
      occurrenceAt: fact.occurredAt,
      operatingDate: period.operatingDate,
      organizationId: scope.organizationId,
      scheduleVersionId: period.scheduleVersionId,
      storeId: scope.storeId,
    };

    expect(
      historicalFactMatchesExistingCanonical({
        existing: existing as never,
        fact,
        period,
        scope,
      }),
    ).toBe(true);
    expect(
      historicalFactMatchesExistingCanonical({
        existing: { ...existing, unitPriceMinor: 2_749 } as never,
        fact,
        period,
        scope,
      }),
    ).toBe(false);
  });

  it("preserves provisional POS lineage and resolved canonical attribution", () => {
    const item = {
      _id: "line-1",
      discount: 500,
      pendingCheckoutItemId: "pending-1",
      productId: "product-provisional",
      productSkuId: "sku-provisional",
      quantity: 2,
      totalPrice: 5_000,
      unitPrice: 2_750,
    };
    expect(historicalPosCommerceLine(item as never)).toMatchObject({
      allocatedDiscountMinor: 500,
      canonicalSkuId: undefined,
      originalSkuId: "sku-provisional",
      pendingCheckoutItemId: "pending-1",
      productId: "product-provisional",
      provisionalSkuId: "sku-provisional",
      skuId: "sku-provisional",
    });
    expect(
      historicalPosCommerceLine(item as never, {
        canonicalProductSkuId: "sku-canonical",
        pendingCheckoutItemId: "pending-1",
      } as never),
    ).toMatchObject({
      canonicalSkuId: "sku-canonical",
      originalSkuId: "sku-provisional",
      provisionalSkuId: "sku-provisional",
      skuId: "sku-provisional",
    });
  });

  it("requires apply to bind to an exact completed compatible preview", () => {
    const preview = {
      factContractVersion: 1,
      frozenWatermark: 200,
      metricContractVersion: 1,
      operation: "historical_backfill_preview",
      organizationId: "org-1",
      periodEnd: 200,
      periodStart: 100,
      projectionContractVersion: 1,
      runType: "backfill",
      status: "completed",
      storeId: "store-1",
    };
    expect(
      assertHistoricalBackfillPreviewCompatible({
        organizationId: "org-1" as never,
        periodEnd: 200,
        periodStart: 100,
        preview: preview as never,
        storeId: "store-1" as never,
      }),
    ).toBe(preview);
    expect(() =>
      assertHistoricalBackfillPreviewCompatible({
        organizationId: "org-1" as never,
        periodEnd: 201,
        preview: preview as never,
        storeId: "store-1" as never,
      }),
    ).toThrow("compatible completed preview");
  });

  it("keeps preview and apply audit accounting in deterministic parity", () => {
    const audit = [
      { outcome: "created" as const, unknownFieldCount: 0, inferredCount: 1 },
      { outcome: "existing" as const, unknownFieldCount: 1 },
      { outcome: "excluded" as const, unknownFieldCount: 0 },
      { outcome: "conflict" as const, unknownFieldCount: 1 },
    ].reduce(
      (counts, outcome) =>
        mergeHistoricalBackfillAuditCounts(
          counts,
          historicalBackfillAuditForOutcome(outcome),
        ),
      EMPTY_HISTORICAL_BACKFILL_AUDIT,
    );

    expect(audit).toMatchObject({
      conflictCount: 1,
      createdCount: 1,
      duplicateCount: 1,
      eligibleCount: 2,
      excludedCount: 1,
      existingCount: 1,
      omittedCount: 2,
      plannedCount: 4,
      unknownCount: 2,
      unknownFieldCount: 2,
      inferredCount: 1,
    });
    expect(historicalBackfillCoverageBasisPoints(audit)).toBe(5_000);
    expect(
      mergeHistoricalBackfillAuditCounts(
        EMPTY_HISTORICAL_BACKFILL_AUDIT,
        audit,
      ),
    ).toEqual(audit);
  });

  it("replays identical interpretation evidence idempotently and rejects drift", async () => {
    const rows: Array<Record<string, unknown>> = [];
    let insertCount = 0;
    const ctx = {
      db: {
        insert: async (_table: string, value: Record<string, unknown>) => {
          insertCount += 1;
          const row = { _id: `evidence-${insertCount}`, ...value };
          rows.push(row);
          return row._id;
        },
        query: () => ({
          withIndex: () => ({
            take: async () => rows,
          }),
        }),
      },
    } as never;
    const input = {
      businessEventKey: "payment_allocation:a-1:recorded:payment",
      factId: "fact-1",
      inferredFields: ["revenueCurrency"],
      originallyMissingFields: ["revenueCurrency"],
      policy: {
        _id: "policy-1",
        approvalHash: "approval-hash-1",
      },
      run: {
        organizationId: "org-1",
        storeId: "store-1",
      },
      sourceDomain: "payments" as const,
    };

    await expect(
      recordHistoricalInterpretationEvidenceWithCtx(ctx, input as never),
    ).resolves.toBe("evidence-1");
    await expect(
      recordHistoricalInterpretationEvidenceWithCtx(ctx, input as never),
    ).resolves.toBe("evidence-1");
    expect(insertCount).toBe(1);

    await expect(
      recordHistoricalInterpretationEvidenceWithCtx(ctx, {
        ...input,
        inferredFields: [],
      } as never),
    ).rejects.toThrow("Historical interpretation evidence conflicts");
  });

  it("replays payment allocations with the same settlement-only canonical identity", () => {
    expect(
      planPaymentAllocationFact({
        _id: "allocation-1",
        amount: 5_000,
        direction: "out",
        recordedAt: 100,
        status: "recorded",
      } as never),
    ).toEqual([
      expect.objectContaining({
        amountMinor: -5_000,
        businessEventKey: "payment_allocation:allocation-1:recorded:payment",
        factType: "payment",
        sourceDomain: "payments",
        currency: null,
      }),
    ]);
  });

  it("fingerprints the prior and corrected settlement methods", () => {
    const base = {
      amountMinor: 0,
      businessEventKey: "pos:tx-1:correction:event-1:correction",
      completeness: "complete" as const,
      correctedSettlementMethod: "card",
      costStatus: "not_applicable" as const,
      currency: null,
      factType: "correction" as const,
      occurredAt: 100,
      priorSettlementMethod: "cash",
      quantity: 0,
      sourceDomain: "pos" as const,
      sourceId: "event-1",
      sourceType: "operational_event",
    };
    const period = {
      operatingDate: "2026-07-09",
      scheduleVersionId: "schedule-1",
    };
    const scope = { organizationId: "org-1", storeId: "store-1" };

    expect(fingerprintHistoricalPlannedFact(base, period, scope)).not.toBe(
      fingerprintHistoricalPlannedFact(
        { ...base, correctedSettlementMethod: "mobile_money" },
        period,
        scope,
      ),
    );
  });

  it("creates stable linked reversals without rewriting the original fact", () => {
    const original = {
      amountMinor: 2_000,
      businessEventKey: "pos:tx-1:complete:line-1",
      completeness: "partial" as const,
      costStatus: "unknown" as const,
      currency: "GHS",
      factType: "sale" as const,
      limitingReason: "uncosted" as const,
      occurredAt: 100,
      productSkuId: "sku-1",
      quantity: 2,
      revenueKind: "merchandise" as const,
      sourceDomain: "pos" as const,
      sourceId: "tx-1",
      sourceLineKey: "line-1",
      sourceType: "pos_transaction",
    };

    expect(
      planHistoricalReversalFacts({
        currency: "GHS",
        kind: "void",
        occurredAt: 200,
        originalFacts: [original],
        reversalBusinessEventKey: "pos:tx-1:void",
      }),
    ).toEqual([
      expect.objectContaining({
        amountMinor: -2_000,
        businessEventKey: "pos:tx-1:void:line:line-1:void",
        factType: "void",
        linkedBusinessEventKey: original.businessEventKey,
        quantity: -2,
      }),
    ]);
  });

  it("quarantines only the oversized event so later cursor rows can continue", () => {
    expect(classifyHistoricalSourceSize(100)).toEqual({
      reason: null,
      status: "eligible",
    });
    expect(classifyHistoricalSourceSize(101)).toEqual({
      reason: "historical_source_line_bound_exceeded",
      status: "quarantined",
    });
    expect(classifyHistoricalSourceSize(60 + 60).status).toBe("quarantined");
  });

  it("builds restart-stable procurement identities and excludes events after the cutoff", () => {
    const input = {
      cutoff: 500,
      currency: "GHS",
      expectedAt: 450,
      lines: [
        {
          id: "line-1",
          lineTotalMinor: 2_000,
          orderedQuantity: 10,
          productSkuId: "sku-1",
          receivedQuantity: 6,
          unitCostMinor: 200,
        },
      ],
      occurredAt: 100,
      purchaseOrderId: "po-1",
      receipts: [
        {
          id: "receipt-before",
          lines: [
            {
              confirmedCurrency: "GHS",
              confirmedUnitCostMinor: 250,
              productSkuId: "sku-1",
              purchaseOrderLineItemId: "line-1",
              receivedQuantity: 6,
            },
          ],
          receivedAt: 400,
        },
        {
          id: "receipt-after",
          lines: [],
          receivedAt: 501,
        },
      ],
      status: "received" as const,
      statusOccurredAt: 480,
    };

    const first = planHistoricalProcurementFacts(input);
    const restarted = planHistoricalProcurementFacts(input);

    expect(restarted).toEqual(first);
    expect(first.map((fact) => fact.businessEventKey)).toEqual([
      "purchase_order:po-1:commitment:line:line-1:line:line-1:procurement_commitment",
      "purchase_order:po-1:expected:450",
      "purchase_order:po-1:receipt:receipt-before:line:line-1:line:line-1:procurement_receipt",
      "purchase_order:po-1:line:line-1:short_receipt",
      "purchase_order:po-1:completed:480",
    ]);
    expect(first).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          businessEventKey: expect.stringContaining("receipt-after"),
        }),
      ]),
    );
    expect(first[2]).toMatchObject({
      amountMinor: 1_200,
      cogsKnownMinor: 1_500,
      currency: "GHS",
      valuationCurrency: "GHS",
    });
  });

  it("releases only the remaining commitment after a partial receipt is cancelled", () => {
    const facts = planHistoricalProcurementFacts({
      cutoff: 500,
      currency: "GHS",
      lines: [
        {
          id: "line-1",
          lineTotalMinor: 2_000,
          orderedQuantity: 10,
          productSkuId: "sku-1",
          receivedQuantity: 2,
          unitCostMinor: 200,
        },
      ],
      occurredAt: 100,
      purchaseOrderId: "po-1",
      receipts: [
        {
          id: "receipt-1",
          lines: [
            {
              confirmedCurrency: "GHS",
              confirmedUnitCostMinor: 250,
              productSkuId: "sku-1",
              purchaseOrderLineItemId: "line-1",
              receivedQuantity: 2,
            },
          ],
          receivedAt: 200,
        },
      ],
      status: "cancelled",
      statusOccurredAt: 300,
    });

    expect(facts.at(-1)).toEqual(
      expect.objectContaining({
        amountMinor: -1_600,
        businessEventKey:
          "purchase_order:po-1:commitment:cancelled:line:line-1:line:line-1:procurement_commitment",
        factType: "procurement_commitment",
        linkedBusinessEventKey:
          "purchase_order:po-1:commitment:line:line-1:line:line-1:procurement_commitment",
        quantity: -8,
      }),
    );
    const contributions = facts.flatMap((fact) =>
      deriveFactMetricContributions({
        amountMinor: fact.amountMinor,
        factType: fact.factType,
        quantity: fact.quantity,
      }),
    );
    const metricTotal = (metric: string) =>
      contributions
        .filter((contribution) => contribution.metric === metric)
        .reduce((total, contribution) => total + contribution.value, 0);

    expect(metricTotal("purchase_commitment_units")).toBe(0);
    expect(metricTotal("purchase_commitment_value")).toBe(0);
    expect(facts[1]).toMatchObject({
      amountMinor: 400,
      cogsKnownMinor: 500,
      valuationCurrency: "GHS",
    });
  });

  it("keeps receipt cost unknown when historical confirmation is absent", () => {
    const facts = planHistoricalProcurementFacts({
      cutoff: 500,
      currency: "GHS",
      lines: [
        {
          id: "line-1",
          lineTotalMinor: 2_000,
          orderedQuantity: 10,
          productSkuId: "sku-1",
          receivedQuantity: 2,
          unitCostMinor: 200,
        },
      ],
      occurredAt: 100,
      purchaseOrderId: "po-1",
      receipts: [
        {
          id: "receipt-1",
          lines: [
            {
              productSkuId: "sku-1",
              purchaseOrderLineItemId: "line-1",
              receivedQuantity: 2,
            },
          ],
          receivedAt: 200,
        },
      ],
      status: "partially_received",
      statusOccurredAt: 200,
    });

    expect(facts[1]).toEqual(
      expect.objectContaining({
        amountMinor: 400,
        cogsKnownMinor: undefined,
        completeness: "partial",
        costStatus: "unknown",
        currency: "GHS",
        limitingReason: "uncosted",
      }),
    );
  });

  it("keeps receipt commitment and valuation currencies in separate historical lanes", () => {
    const facts = planHistoricalProcurementFacts({
      cutoff: 500,
      currency: "GHS",
      lines: [
        {
          id: "line-1",
          lineTotalMinor: 2_000,
          orderedQuantity: 10,
          productSkuId: "sku-1",
          receivedQuantity: 2,
          unitCostMinor: 200,
        },
      ],
      occurredAt: null,
      purchaseOrderId: "po-1",
      receipts: [
        {
          id: "receipt-1",
          lines: [
            {
              confirmedCurrency: "USD",
              confirmedUnitCostMinor: 250,
              productSkuId: "sku-1",
              purchaseOrderLineItemId: "line-1",
              receivedQuantity: 2,
            },
          ],
          receivedAt: 200,
        },
      ],
      status: "partially_received",
      statusOccurredAt: 200,
    });

    expect(facts).toEqual([
      expect.objectContaining({
        amountMinor: 400,
        cogsKnownMinor: 500,
        currency: "GHS",
        factType: "procurement_receipt",
        valuationCurrency: "USD",
      }),
    ]);
  });

  it("retains an expected arrival known at the cutoff even when its date is later", () => {
    expect(
      planHistoricalProcurementFacts({
        cutoff: 500,
        currency: "GHS",
        expectedAt: 700,
        lines: [],
        occurredAt: 100,
        purchaseOrderId: "po-1",
        receipts: [],
        status: "ordered",
        statusOccurredAt: 200,
      }),
    ).toContainEqual(
      expect.objectContaining({
        businessEventKey: "purchase_order:po-1:expected:700",
        occurredAt: 100,
      }),
    );
  });

  it("cannot call operational inventory writers or activate report generations", () => {
    const source = readFileSync(
      "convex/reporting/maintenance/backfill.ts",
      "utf8",
    );

    expect(source).not.toContain("applyInventoryEffectWithCtx");
    expect(source).not.toContain("appendReportingIngressWithCtx");
    expect(source).not.toContain('ctx.db.patch("productSku"');
    expect(source).not.toContain('ctx.db.insert("inventoryMovement"');
    expect(source).not.toContain(
      'ctx.db.insert("reportingProjectionActivation"',
    );
    expect(source).toContain('"pos_void"');
    expect(source).toContain('"pos_adjustment"');
    expect(source).toContain('"pos_payment_correction"');
    expect(source).toContain('"storefront_refund"');
    expect(source).toContain('? "delivered" : "picked-up"');
    expect(source).not.toContain('order.status === "picked_up"');
    expect(source).toContain("historical_source_line_bound_exceeded");
    expect(source).toContain("historical_fact_conflict");
    expect(source).toContain(
      "`apply:${String(preview!._id)}:${args.requestKey}`",
    );
    expect(source).toContain("historicalFactMatchesExistingCanonical({");
    expect(source).toContain('if (!run.operation.endsWith("preview"))');
    expect(source).toContain("const PAGE_SIZE = 1");
    expect(source).toContain("items.length + services.length");
    expect(source).not.toContain("take(501)");
  });

  it("declares only the missing bounded procurement source indexes", () => {
    const schema = readFileSync("convex/schema.ts", "utf8");

    expect(schema).toContain(
      '.index("by_storeId_createdAt", ["storeId", "createdAt"])',
    );
    expect(schema).toContain(
      '.index("by_storeId_receivedAt", ["storeId", "receivedAt"])',
    );
  });

  it("writes apply facts only from bounded sealed manifest pages", () => {
    const source = readFileSync(
      "convex/reporting/maintenance/backfill.ts",
      "utf8",
    );
    const start = source.indexOf(
      'run.operation === "historical_backfill_manifest_apply"',
    );
    const end = source.indexOf(
      "const cursor = decodeHistoricalBackfillCursor",
      start,
    );
    const writePass = source.slice(start, end);
    expect(writePass).toContain(
      '.query("reportingBackfillApplyManifestItem")',
    );
    expect(writePass).toContain(".paginate({ cursor: run.cursor ?? null");
    expect(writePass).toContain("parseHistoricalManifestCandidate(");
    expect(writePass).toContain("apply: true");
    expect(writePass).not.toContain("loadPosPage(");
    expect(writePass).not.toContain("loadStorefrontPage(");
    expect(writePass).not.toContain("loadPaymentAllocationPage(");
  });
});
