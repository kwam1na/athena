import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  POS_CENSUS_BACKFILL_PHASES,
  advancePosCensusCursor,
  assertAuthorizedPosCensusStart,
  assertSealedJournalTerminal,
  authoritativePosSourceDigestStep,
  authoritativePosSemanticsMatch,
  adjustmentSourceIsTransactionBound,
  classifyAppliedAdjustmentCensusTime,
  classifyAuthorizedPosReconciliationCompletion,
  classifyPaymentCorrectionAuditSource,
  classifyPosCensusSourceShape,
  expectedAuthoritativePosPreviewKeys,
  paymentCorrectionSourceIsTransactionBound,
  posTransactionHeaderMatchesSourceLines,
  journalTerminalMatches,
  lifecycleJournalPreviewPrefix,
  manifestItemIsKnownExcludedPosSource,
  manifestOutcomeParticipatesInAuthoritativeSemantics,
  posManifestFactSemanticsMatch,
  sourceDerivedPosCensusHash,
} from "./posCensusBackfill";

const lineage = {
  grant: {
    _id: "grant-1",
    contractVersion: 2,
    migrationPurpose: "reports_financial_truth_reset_backfill",
    organizationId: "org-1",
    runId: "run-1",
    sourceScope: "pos",
    status: "running",
    storeId: "store-1",
  },
  run: {
    _id: "run-1",
    backfillAuthorizationGrantId: "grant-1",
    censusToken: "census-1",
    cursor: "purge:verified",
    financialDateContractVersion: 2,
    organizationId: "org-1",
    sourceScope: "pos",
    status: "running",
    storeId: "store-1",
  },
} as const;

describe("authorized POS census backfill", () => {
  it("automatically starts every bundle member from the verified sealed watermark", () => {
    const source = readFileSync(
      "convex/reporting/maintenance/posCensusBackfill.ts",
      "utf8",
    );
    expect(source).toContain('projectionKind: "store_day"');
    expect(source).toContain('projectionKind: "sku_day"');
    expect(source).toContain("startCurrentInventoryRebuild");
    expect(source).toContain("frozenWatermark: applyRun.frozenWatermark");
  });

  it("uses only authoritative POS lifecycle phases", () => {
    expect(POS_CENSUS_BACKFILL_PHASES).toEqual([
      "pos",
      "pos_void",
      "pos_refund",
      "pos_adjustment",
      "pos_payment_correction",
      "done",
    ]);
    expect(POS_CENSUS_BACKFILL_PHASES).not.toContain("storefront_delivered");
    expect(POS_CENSUS_BACKFILL_PHASES).not.toContain("service");
    expect(POS_CENSUS_BACKFILL_PHASES).not.toContain("payment_allocation");
  });

  it("advances from payment corrections directly to done", () => {
    expect(
      advancePosCensusCursor({
        continueCursor: "ignored",
        isDone: true,
        phase: "pos_payment_correction",
      }),
    ).toEqual({ pageCursor: null, phase: "done" });
  });

  it("completes only from the persisted verified certificate", () => {
    expect(
      classifyAuthorizedPosReconciliationCompletion({
        frozenWatermark: 500,
        orphanDispositionMatchesApply: true,
        persistedStatus: "verified",
        unexplainedCount: 0,
      }),
    ).toMatchObject({
      cursor: "pos_reconciliation:verified",
      failedCount: 0,
      status: "completed",
      verified: true,
    });
    expect(
      classifyAuthorizedPosReconciliationCompletion({
        frozenWatermark: 500,
        orphanDispositionMatchesApply: true,
        persistedStatus: "blocked",
        unexplainedCount: 0,
      }),
    ).toMatchObject({
      cursor: "pos_reconciliation:blocked",
      failedCount: 1,
      status: "failed",
      verified: false,
    });
  });

  it("requires exact grant, run, census, financial-date, and reset lineage", () => {
    expect(() => assertAuthorizedPosCensusStart(lineage)).not.toThrow();
    expect(() =>
      assertAuthorizedPosCensusStart({
        ...lineage,
        run: { ...lineage.run, sourceScope: "inventory" as never },
      }),
    ).toThrow("sourceScope");
    expect(() =>
      assertAuthorizedPosCensusStart({
        ...lineage,
        run: { ...lineage.run, cursor: "purge:running" },
      }),
    ).toThrow("purge verification");
  });

  it("maps journal identities to the canonical preview prefix", () => {
    expect(
      lifecycleJournalPreviewPrefix({
        eventKey: "pos:txn-1:completed",
        eventKind: "completed",
        transactionId: "txn-1",
      }),
    ).toBe("pos:txn-1:complete");
    expect(
      lifecycleJournalPreviewPrefix({
        adjustmentId: "adjustment-1",
        eventKey: "pos:txn-1:adjustment:adjustment-1",
        eventKind: "adjustment_applied",
        transactionId: "txn-1",
      }),
    ).toBe("pos:txn-1:adjustment:adjustment-1");
    expect(
      lifecycleJournalPreviewPrefix({
        adjustmentId: "adjustment-1",
        eventKey: "pos:txn-1:refund-adjustment:adjustment-1",
        eventKind: "refunded",
        transactionId: "txn-1",
      }),
    ).toBe("pos:txn-1:adjustment:adjustment-1");
  });

  it("detects a late pre-watermark journal event and binds raw source evidence", () => {
    expect(
      journalTerminalMatches(
        { id: "journal-1", recordedAt: 200 },
        { id: "journal-2", recordedAt: 201 },
      ),
    ).toBe(false);
    const first = authoritativePosSourceDigestStep("empty", {
      id: "txn-1",
      total: 100,
    });
    expect(first).toBe(
      authoritativePosSourceDigestStep("empty", {
        id: "txn-1",
        total: 100,
      }),
    );
    expect(first).not.toBe(
      authoritativePosSourceDigestStep("empty", {
        id: "txn-1",
        total: 101,
      }),
    );
  });

  it("requires every sale, service, adjustment, refund, and correction identity", () => {
    expect(
      expectedAuthoritativePosPreviewKeys({
        adjustmentLines: [
          {
            adjustmentId: "adjustment-1",
            deltaTotal: -300,
            lines: [
              {
                id: "adjustment-line-1",
                correctedTotal: 200,
                originalTotal: 500,
                quantityDelta: -1,
              },
              {
                id: "adjustment-line-2",
                correctedTotal: 100,
                originalTotal: 100,
                quantityDelta: 0,
              },
            ],
          },
        ],
        itemAndServiceLineIds: ["item-1", "service-1"],
        paymentCorrectionIds: ["correction-1"],
        refundedLines: [{ id: "service-1", refundedAt: 300 }],
        status: "completed",
        tax: 50,
        total: 1_050,
        transactionId: "txn-1",
      }),
    ).toEqual([
      "pos:txn-1:complete:line:item-1:sale",
      "pos:txn-1:complete:line:service-1:sale",
      "pos:txn-1:complete:line:tax:sale",
      "pos:txn-1:refund:service-1:300:line:service-1:refund",
      "pos:txn-1:adjustment:adjustment-1:line:adjustment-line-1",
      "pos:txn-1:correction:correction-1",
    ]);
  });

  it("classifies only structurally bound missing-parent corrections as known exclusions", () => {
    expect(
      classifyPaymentCorrectionAuditSource({
        posTransactionId: "txn-missing",
        storeId: "store-1",
        subjectId: "txn-missing",
        subjectType: "pos_transaction",
        transaction: null,
      }),
    ).toBe("orphan_payment_correction");
    expect(
      classifyPaymentCorrectionAuditSource({
        posTransactionId: "txn-1",
        storeId: "store-1",
        subjectId: "txn-other",
        subjectType: "pos_transaction",
        transaction: { id: "txn-1", storeId: "store-1" },
      }),
    ).toBe("unexplained");
    expect(
      classifyPaymentCorrectionAuditSource({
        posTransactionId: "txn-1",
        storeId: "store-1",
        subjectId: "txn-1",
        subjectType: "pos_transaction",
        transaction: { id: "txn-1", storeId: "store-2" },
      }),
    ).toBe("unexplained");
  });

  it("accepts only a fully sealed orphan disposition as a known non-fact", () => {
    const sealed = {
      candidateExclusionReason: "orphan_payment_correction",
      candidateSourceType: "operational_event",
      itemExclusionReason: "orphan_payment_correction",
      outcome: "excluded",
    };
    expect(manifestItemIsKnownExcludedPosSource(sealed)).toBe(true);
    expect(
      manifestItemIsKnownExcludedPosSource({
        ...sealed,
        itemExclusionReason: undefined,
      }),
    ).toBe(false);
    expect(
      manifestItemIsKnownExcludedPosSource({
        ...sealed,
        candidateSourceType: "pos_transaction",
      }),
    ).toBe(false);
  });

  it("does not require a void reversal that occurs after the frozen watermark", () => {
    expect(
      expectedAuthoritativePosPreviewKeys({
        adjustmentLines: [],
        includeVoid: false,
        itemAndServiceLineIds: ["item-1"],
        paymentCorrectionIds: [],
        refundedLines: [],
        status: "void",
        tax: 0,
        total: 500,
        transactionId: "txn-1",
      }),
    ).toEqual(["pos:txn-1:complete:line:item-1:sale"]);
  });

  it("mirrors the planner summary identity when line evidence is incoherent", () => {
    expect(
      expectedAuthoritativePosPreviewKeys({
        adjustmentLines: [],
        includeVoid: true,
        itemAndServiceLineIds: ["item-1", "item-2"],
        paymentCorrectionIds: [],
        refundedLines: [{ id: "item-1", refundedAt: 200 }],
        saleIdentityMode: "transaction_summary",
        status: "void",
        tax: 100,
        total: 1_100,
        transactionId: "txn-1",
      }),
    ).toEqual([
      "pos:txn-1:complete:transaction_summary",
      "pos:txn-1:void:line:transaction_summary:void",
    ]);
  });

  it("preserves summary identity across planner and census safety bounds", () => {
    expect(
      classifyPosCensusSourceShape({
        adjustmentCount: 500,
        eventCount: 500,
        itemCount: 500,
        serviceCount: 0,
      }),
    ).toEqual({
      adjustmentBoundExceeded: false,
      eventBoundExceeded: false,
      saleLineBoundExceeded: false,
    });
    expect(
      classifyPosCensusSourceShape({
        adjustmentCount: 501,
        eventCount: 501,
        itemCount: 501,
        serviceCount: 0,
      }),
    ).toEqual({
      adjustmentBoundExceeded: true,
      eventBoundExceeded: true,
      saleLineBoundExceeded: true,
    });
    expect(manifestOutcomeParticipatesInAuthoritativeSemantics("created")).toBe(
      true,
    );
    expect(
      manifestOutcomeParticipatesInAuthoritativeSemantics("quarantined"),
    ).toBe(false);
  });

  it("rejects planner corruption in money, units, date, and currency", () => {
    const expected = {
      amountMinor: 500,
      attributionKind: "pending_checkout" as const,
      attributionVersion: 1,
      canonicalProductSkuId: "sku-canonical",
      currency: "GHS",
      factType: "sale" as const,
      key: "pos:txn-1:complete:line:item-1:sale",
      occurredAt: 100,
      originalProductSkuId: "sku-1",
      pendingCheckoutItemId: "pending-1",
      productId: "product-1",
      productSkuId: "sku-1",
      provisionalProductSkuId: "sku-1",
      quantity: 2,
      revenueKind: "merchandise" as const,
    };
    const candidate = {
      ...expected,
      currency: "GHS",
    };
    const expectedPeriod = {
      reportingDate: "2026-07-12",
      timezoneVersionHash: "tz-hash-1",
      timezoneVersionId: "tz-1",
    };
    const resolvedPeriod = {
      operatingDate: "2026-07-12",
      timezoneVersionHash: "tz-hash-1",
      timezoneVersionId: "tz-1",
    };
    expect(
      authoritativePosSemanticsMatch({
        candidate,
        expected,
        expectedPeriod,
        resolvedPeriod,
      }),
    ).toBe(true);
    for (const corrupted of [
      { ...candidate, amountMinor: 499 },
      { ...candidate, quantity: 1 },
      { ...candidate, currency: "USD" },
      { ...candidate, productId: "product-2" },
      { ...candidate, productSkuId: "sku-2" },
      { ...candidate, canonicalProductSkuId: "sku-stale" },
      { ...candidate, pendingCheckoutItemId: "pending-stale" },
      { ...candidate, provisionalProductSkuId: undefined },
    ]) {
      expect(
        authoritativePosSemanticsMatch({
          candidate: corrupted,
          expected,
          expectedPeriod,
          resolvedPeriod,
        }),
      ).toBe(false);
    }
    expect(
      authoritativePosSemanticsMatch({
        candidate,
        expected,
        expectedPeriod,
        resolvedPeriod: { ...resolvedPeriod, operatingDate: "2026-07-11" },
      }),
    ).toBe(false);
  });

  it("reconciles line money to the authoritative transaction header", () => {
    expect(
      posTransactionHeaderMatchesSourceLines({
        lineTotals: [500, 250],
        subtotal: 750,
        tax: 75,
        total: 825,
      }),
    ).toBe(true);
    expect(
      posTransactionHeaderMatchesSourceLines({
        lineTotals: [500],
        subtotal: 750,
        tax: 75,
        total: 825,
      }),
    ).toBe(false);
    expect(
      posTransactionHeaderMatchesSourceLines({
        lineTotals: [],
        subtotal: 750,
        tax: 75,
        total: 825,
      }),
    ).toBe(true);
    expect(
      posTransactionHeaderMatchesSourceLines({
        lineTotals: [],
        subtotal: 750,
        tax: 75,
        total: 800,
      }),
    ).toBe(false);
  });

  it("blocks orphan and cross-store adjustment and correction sources", () => {
    expect(
      classifyAppliedAdjustmentCensusTime({
        frozenWatermark: 500,
        status: "applied",
      }),
    ).toBe("malformed");
    expect(
      adjustmentSourceIsTransactionBound({
        adjustmentTransactionId: "txn-1",
        storeId: "store-1",
        transaction: null,
      }),
    ).toBe(false);
    expect(
      adjustmentSourceIsTransactionBound({
        adjustmentTransactionId: "txn-1",
        storeId: "store-1",
        transaction: { id: "txn-1", storeId: "store-2" },
      }),
    ).toBe(false);
    expect(
      paymentCorrectionSourceIsTransactionBound({
        posTransactionId: "txn-1",
        storeId: "store-1",
        subjectId: "txn-1",
        subjectType: "pos_transaction",
        transaction: null,
      }),
    ).toBe(false);
    expect(
      paymentCorrectionSourceIsTransactionBound({
        posTransactionId: "txn-1",
        storeId: "store-1",
        subjectId: "txn-1",
        subjectType: "pos_transaction",
        transaction: { id: "txn-1", storeId: "store-2" },
      }),
    ).toBe(false);
    expect(
      paymentCorrectionSourceIsTransactionBound({
        posTransactionId: "txn-1",
        storeId: "store-1",
        subjectId: "txn-1",
        subjectType: "pos_transaction",
        transaction: { id: "txn-1", storeId: "store-1" },
      }),
    ).toBe(true);
  });

  it("rejects a lifecycle event recorded between sealed preview and apply", () => {
    expect(() =>
      assertSealedJournalTerminal({
        apply: { id: "journal-2", recordedAt: 201 },
        preview: { id: "journal-1", recordedAt: 200 },
      }),
    ).toThrow("journal terminal changed after preview");
    expect(() =>
      assertSealedJournalTerminal({
        apply: { id: "journal-1", recordedAt: 200 },
        preview: { id: "journal-1", recordedAt: 200 },
      }),
    ).not.toThrow();
  });

  it("binds the source census hash to manifest, journal, watermark, and contracts", () => {
    const input = {
      authoritativeSourceCount: 10,
      authoritativeSourceDigest: "source-a",
      factContractVersion: 2,
      financialDateContractVersion: 2,
      frozenWatermark: 500,
      journalTerminalId: "journal-9",
      journalTerminalRecordedAt: 490,
      manifestDigest: "manifest-a",
    };
    const hash = sourceDerivedPosCensusHash(input);
    expect(hash).toBe(sourceDerivedPosCensusHash({ ...input }));
    expect(hash).not.toBe(
      sourceDerivedPosCensusHash({ ...input, manifestDigest: "manifest-b" }),
    );
    expect(hash).not.toBe(
      sourceDerivedPosCensusHash({ ...input, journalTerminalId: "journal-10" }),
    );
    expect(hash).not.toBe(
      sourceDerivedPosCensusHash({
        ...input,
        authoritativeSourceDigest: "source-b",
      }),
    );
    expect(hash).not.toBe(
      sourceDerivedPosCensusHash({
        ...input,
        skuAttributionTerminalSequence: 1,
      }),
    );
    expect(hash).not.toBe(
      sourceDerivedPosCensusHash({
        ...input,
        orphanPaymentCorrectionCount: 1,
      }),
    );
  });

  it("compares complete lifecycle, date-lineage, and settlement semantics", () => {
    const source = {
      amountMinor: 0,
      attributionKind: "pending_checkout",
      attributionVersion: 1,
      canonicalProductSkuId: "sku-canonical",
      completeness: "complete",
      correctedSettlementMethod: "card",
      costStatus: "not_applicable",
      factType: "correction",
      linkedBusinessEventKey: "pos:txn-1:complete",
      priorSettlementMethod: "cash",
      quantity: 0,
      sourceLineKey: undefined,
    };
    const resolvedPeriod = {
      operatingDate: "2026-07-10",
      scheduleContext: "outside_hours",
      scheduleVersionId: "schedule-1",
      timezoneVersionHash: "tz-hash-1",
      timezoneVersionId: "timezone-1",
    };
    const fact = {
      ...source,
      currencyCode: undefined,
      factContractVersion: 2,
      metricContractVersion: 1,
      operatingDate: "2026-07-10",
      scheduleContext: "outside_hours",
      scheduleVersionId: "schedule-1",
      status: "canonical",
      timezoneVersionHash: "tz-hash-1",
      timezoneVersionId: "timezone-1",
    };
    expect(
      posManifestFactSemanticsMatch({
        fact,
        factContractVersion: 2,
        metricContractVersion: 1,
        resolvedPeriod,
        source,
      }),
    ).toBe(true);
    expect(
      posManifestFactSemanticsMatch({
        fact: { ...fact, correctedSettlementMethod: "mobile_money" },
        factContractVersion: 2,
        metricContractVersion: 1,
        resolvedPeriod,
        source,
      }),
    ).toBe(false);
    expect(
      posManifestFactSemanticsMatch({
        fact: { ...fact, canonicalProductSkuId: "sku-stale" },
        factContractVersion: 2,
        metricContractVersion: 1,
        resolvedPeriod,
        source,
      }),
    ).toBe(false);
    expect(
      posManifestFactSemanticsMatch({
        fact: { ...fact, timezoneVersionHash: "wrong" },
        factContractVersion: 2,
        metricContractVersion: 1,
        resolvedPeriod,
        source,
      }),
    ).toBe(false);
  });
});
