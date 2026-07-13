import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  classifyPosRefundEvidence,
  posAdjustmentSourceIsCoherent,
  posOriginalSaleIdentityMode,
  posOriginalSaleSourceIsCoherent,
  posSkuAttributionMatchesSourceItem,
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
  historicalPosCommerceLine,
  HISTORICAL_BACKFILL_SCANNED_SOURCE_DOMAINS,
  mergeHistoricalBackfillAuditCounts,
  normalizeHistoricalFactWithPolicy,
  EMPTY_HISTORICAL_BACKFILL_AUDIT,
  planPaymentAllocationFact,
  planPosAdjustmentRow,
  planPosPaymentCorrectionRow,
  planPosRow,
  planHistoricalProcurementFacts,
  planHistoricalReversalFacts,
  parseHistoricalManifestCandidate,
  recordHistoricalInterpretationEvidenceWithCtx,
  reconcileHistoricalBackfillCounts,
} from "./backfill";
import { deriveFactMetricContributions } from "../projections/factContributions";

describe("reporting historical backfill", () => {
  function posPlanningCtx(input: {
    attributions?: unknown[];
    items?: unknown[];
    originalItems?: Array<Record<string, unknown>>;
    pendingItems?: Array<Record<string, unknown>>;
    productSkus?: Array<Record<string, unknown>>;
    services?: unknown[];
    adjustmentLines?: unknown[];
    transactions?: Array<Record<string, unknown>>;
  }) {
    return {
      db: {
        get: async (table: string, id: unknown) => {
          if (table === "posTransactionItem") {
            return input.originalItems?.find((row) => row._id === id) ?? null;
          }
          if (table === "posTransaction") {
            return input.transactions?.find((row) => row._id === id) ?? null;
          }
          if (table === "productSku") {
            const configured = input.productSkus?.find(
              (row) => row._id === id,
            );
            if (configured) return configured;
            const sourceItem = input.items?.find(
              (row) =>
                (row as { productSkuId?: unknown }).productSkuId === id,
            ) as { productId?: unknown } | undefined;
            return sourceItem
              ? {
                  _id: id,
                  productId: sourceItem.productId,
                  storeId: "store-1",
                }
              : null;
          }
          if (table === "product") {
            return { _id: id, organizationId: "org-1", storeId: "store-1" };
          }
          if (table === "serviceCase") {
            return { _id: id, organizationId: "org-1", storeId: "store-1" };
          }
          if (table === "posPendingCheckoutItem") {
            return (
              input.pendingItems?.find((row) => row._id === id) ??
              { _id: id, organizationId: "org-1", storeId: "store-1" }
            );
          }
          if (table === "inventoryImportProvisionalSku") {
            return { _id: id, organizationId: "org-1", storeId: "store-1" };
          }
          return null;
        },
        query: (table: string) => ({
          withIndex: () => ({
            first: async () =>
              table === "reportingSkuAttribution"
                ? (input.attributions?.[0] ?? null)
                : null,
            take: async () =>
              table === "posTransactionItem"
                ? (input.items ?? [])
                : table === "posTransactionServiceLine"
                  ? (input.services ?? [])
                  : table === "posTransactionAdjustmentLine"
                    ? (input.adjustmentLines ?? [])
                    : table === "reportingSkuAttribution"
                      ? (input.attributions ?? [])
                      : [],
          }),
        }),
      },
    } as never;
  }

  it("plans partial merchandise and service refunds from completed transactions", async () => {
    const transaction = {
      _creationTime: 90,
      _id: "txn-1",
      completedAt: 100,
      status: "completed",
      tax: 0,
      total: 1_500,
    } as never;
    const facts = await planPosRow(
      posPlanningCtx({
        items: [
          {
            _id: "item-1",
            isRefunded: true,
            productId: "product-1",
            productSkuId: "sku-1",
            quantity: 2,
            refundedAt: 120,
            refundedQuantity: 1,
            totalPrice: 1_000,
            unitPrice: 500,
          },
        ],
        services: [
          {
            _id: "service-1",
            isRefunded: true,
            quantity: 1,
            refundedAt: 121,
            refundedQuantity: 1,
            serviceCaseId: "case-1",
            totalPrice: 500,
            unitPrice: 500,
          },
        ],
      }),
      transaction,
      { _id: "store-1", currency: "GHS", organizationId: "org-1" } as never,
      "refund",
      200,
    );

    expect(facts).toHaveLength(2);
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amountMinor: -500,
          factType: "refund",
          productSkuId: "sku-1",
          quantity: -1,
        }),
        expect.objectContaining({
          amountMinor: -500,
          factType: "refund",
          serviceCaseId: "case-1",
          quantity: -1,
        }),
      ]),
    );
  });

  it("defers a post-watermark void while preserving the completed sale", async () => {
    const facts = await planPosRow(
      posPlanningCtx({
        items: [
          {
            _id: "item-1",
            productId: "product-1",
            productSkuId: "sku-1",
            quantity: 1,
            totalPrice: 500,
            unitPrice: 500,
          },
        ],
      }),
      {
        _creationTime: 90,
        _id: "txn-1",
        completedAt: 100,
        status: "void",
        storeId: "store-1",
        tax: 0,
        total: 500,
        voidedAt: 201,
      } as never,
      { _id: "store-1", currency: "GHS", organizationId: "org-1" } as never,
      "void",
      200,
    );

    expect(facts).toHaveLength(1);
    expect(facts[0]).toEqual(
      expect.objectContaining({ factType: "sale", occurredAt: 100 }),
    );
  });

  it("binds pending-checkout attribution into the planned SKU fact", async () => {
    const facts = await planPosRow(
      posPlanningCtx({
        attributions: [
          {
            canonicalProductId: "product-canonical",
            canonicalProductSkuId: "sku-canonical",
            organizationId: "org-1",
            originalProductId: "product-1",
            originalProductSkuId: "sku-provisional",
            pendingCheckoutItemId: "pending-1",
            status: "completed",
            storeId: "store-1",
          },
        ],
        pendingItems: [
          {
            _id: "pending-1",
            organizationId: "org-1",
            provisionalProductId: "product-1",
            provisionalProductSkuId: "sku-provisional",
            status: "flagged",
            storeId: "store-1",
          },
        ],
        productSkus: [
          {
            _id: "sku-canonical",
            productId: "product-canonical",
            storeId: "store-1",
          },
        ],
        items: [
          {
            _id: "item-1",
            pendingCheckoutItemId: "pending-1",
            productId: "product-1",
            productSkuId: "sku-provisional",
            quantity: 1,
            totalPrice: 500,
            unitPrice: 500,
          },
        ],
      }),
      {
        _creationTime: 90,
        _id: "txn-1",
        completedAt: 100,
        status: "completed",
        storeId: "store-1",
        tax: 0,
        total: 500,
      } as never,
      { _id: "store-1", currency: "GHS", organizationId: "org-1" } as never,
    );

    expect(facts[0]).toEqual(
      expect.objectContaining({
        attributionKind: "pending_checkout",
        canonicalProductSkuId: "sku-canonical",
        pendingCheckoutItemId: "pending-1",
        provisionalProductSkuId: "sku-provisional",
      }),
    );
  });

  it("classifies malformed partial-refund evidence as blocking", () => {
    for (const input of [
      {
        isRefunded: true,
        quantity: 2,
        refundedQuantity: 1,
      },
      {
        isRefunded: true,
        quantity: 2,
        refundedAt: 120,
        refundedQuantity: 0,
      },
      {
        isRefunded: true,
        quantity: 2,
        refundedAt: 120,
        refundedQuantity: 3,
      },
      {
        isRefunded: false,
        quantity: 2,
        refundedAt: 120,
        refundedQuantity: 1,
      },
      {
        isRefunded: true,
        quantity: 2,
        refundedAt: 99,
        refundedQuantity: 1,
      },
    ]) {
      expect(
        classifyPosRefundEvidence({
          ...input,
          completedAt: 100,
          frozenWatermark: 200,
        }),
      ).toEqual({ status: "malformed" });
    }
  });

  it("quarantines malformed partial refunds instead of silently skipping them", async () => {
    const facts = await planPosRow(
      posPlanningCtx({
        items: [
          {
            _id: "missing-time",
            isRefunded: true,
            productId: "product-1",
            productSkuId: "sku-1",
            quantity: 2,
            refundedQuantity: 1,
            totalPrice: 1_000,
            unitPrice: 500,
          },
          {
            _id: "too-many",
            isRefunded: true,
            productId: "product-2",
            productSkuId: "sku-2",
            quantity: 2,
            refundedAt: 120,
            refundedQuantity: 3,
            totalPrice: 1_000,
            unitPrice: 500,
          },
        ],
      }),
      {
        _creationTime: 90,
        _id: "txn-malformed-refunds",
        completedAt: 100,
        status: "completed",
        tax: 0,
        total: 2_000,
      } as never,
      { _id: "store-1", currency: "GHS", organizationId: "org-1" } as never,
      "refund",
      200,
    );

    expect(facts).toHaveLength(2);
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          businessEventKey:
            "pos:txn-malformed-refunds:refund:missing-time:source_incomplete",
          limitingReason: "source_incomplete",
        }),
        expect.objectContaining({
          businessEventKey:
            "pos:txn-malformed-refunds:refund:too-many:source_incomplete",
          limitingReason: "source_incomplete",
        }),
      ]),
    );
  });

  it("does not invent refund quarantine for an ordinary non-refunded sale", async () => {
    const facts = await planPosRow(
      posPlanningCtx({
        items: [
          {
            _id: "item-1",
            productId: "product-1",
            productSkuId: "sku-1",
            quantity: 1,
            totalPrice: 500,
            unitPrice: 500,
          },
        ],
      }),
      {
        _creationTime: 90,
        _id: "txn-1",
        completedAt: 100,
        status: "completed",
        tax: 0,
        total: 500,
      } as never,
      { _id: "store-1", currency: "GHS", organizationId: "org-1" } as never,
      "refund",
      200,
    );

    expect(facts).toEqual([]);
  });

  it("preserves trustworthy transaction money when line identity is unusable", async () => {
    const facts = await planPosRow(
      posPlanningCtx({
        items: Array.from({ length: 101 }, (_, index) => ({ _id: `item-${index}` })),
      }),
      {
        _creationTime: 90,
        _id: "txn-1",
        completedAt: 100,
        status: "completed",
        tax: 0,
        total: 12_345,
      } as never,
      { _id: "store-1", currency: "GHS", organizationId: "org-1" } as never,
    );

    expect(facts).toEqual([
      expect.objectContaining({
        amountMinor: 12_345,
        businessEventKey: "pos:txn-1:complete:transaction_summary",
        completeness: "partial",
        currency: "GHS",
        limitingReason: "source_incomplete",
        quantity: undefined,
      }),
    ]);
  });

  it("classifies negative applied adjustment lines as refund lifecycle facts", async () => {
    const facts = await planPosAdjustmentRow(
      posPlanningCtx({
        adjustmentLines: [
          {
            _id: "line-1",
            adjustmentId: "adjustment-1",
            correctedQuantity: 1,
            correctedTotal: 500,
            inventoryDelta: 1,
            lineType: "existing",
            originalQuantity: 2,
            originalTotal: 1_000,
            originalTransactionItemId: "item-1",
            productId: "product-1",
            productSkuId: "sku-1",
            quantityDelta: -1,
            storeId: "store-1",
            transactionId: "txn-1",
            unitPrice: 500,
          },
          {
            _id: "line-unchanged",
            adjustmentId: "adjustment-1",
            correctedQuantity: 1,
            correctedTotal: 500,
            inventoryDelta: 0,
            lineType: "existing",
            originalQuantity: 1,
            originalTotal: 500,
            originalTransactionItemId: "item-unchanged",
            productId: "product-2",
            productSkuId: "sku-2",
            quantityDelta: 0,
            storeId: "store-1",
            transactionId: "txn-1",
            unitPrice: 500,
          },
        ],
        originalItems: [
          {
            _id: "item-1",
            productId: "product-1",
            productSkuId: "sku-1",
            quantity: 2,
            totalPrice: 1_000,
            transactionId: "txn-1",
            unitPrice: 500,
          },
          {
            _id: "item-unchanged",
            productId: "product-2",
            productSkuId: "sku-2",
            quantity: 1,
            totalPrice: 500,
            transactionId: "txn-1",
            unitPrice: 500,
          },
        ],
        transactions: [
          {
            _id: "txn-1",
            completedAt: 100,
            storeId: "store-1",
            subtotal: 1_500,
            tax: 0,
            total: 1_500,
          },
        ],
      }),
      {
        _id: "adjustment-1",
        appliedAt: 200,
        currency: "GHS",
        correctedSubtotal: 1_000,
        correctedTax: 0,
        correctedTotal: 1_000,
        deltaTotal: -500,
        originalSubtotal: 1_500,
        originalTax: 0,
        originalTotal: 1_500,
        storeId: "store-1",
        transactionId: "txn-1",
      } as never,
      { _id: "store-1", organizationId: "org-1" } as never,
    );

    expect(facts).toEqual([
      expect.objectContaining({
        amountMinor: -500,
        factType: "refund",
        quantity: -1,
      }),
    ]);
    expect(deriveFactMetricContributions(facts[0]!)).toEqual(
      expect.arrayContaining([
        { metric: "refunds", value: 500 },
        { metric: "units_returned", value: 1 },
      ]),
    );
  });

  it("excludes a structurally bound payment correction whose parent is absent", async () => {
    const facts = await planPosPaymentCorrectionRow(
      posPlanningCtx({ transactions: [] }),
      {
        _id: "event-1",
        createdAt: 200,
        eventType: "pos_transaction_payment_method_corrected",
        metadata: {
          paymentMethod: "card",
          previousPaymentMethod: "cash",
        },
        posTransactionId: "txn-missing",
        storeId: "store-1",
        subjectId: "txn-missing",
        subjectType: "pos_transaction",
      } as never,
      { _id: "store-1", currency: "GHS" } as never,
    );

    expect(facts).toEqual([
      expect.objectContaining({
        currency: null,
        exclusionReason: "orphan_payment_correction",
        sourceId: "event-1",
      }),
    ]);
    expect(
      normalizeHistoricalFactWithPolicy({
        fact: facts[0]!,
        policy: {
          intervalEnd: 300,
          intervalStart: 100,
          revenueCurrencyCode: "GHS",
        } as never,
      }),
    ).toMatchObject({ inferredFields: [], originallyMissingFields: [] });
  });

  it("quarantines a payment correction bound to an existing cross-store parent", async () => {
    const facts = await planPosPaymentCorrectionRow(
      posPlanningCtx({
        transactions: [
          {
            _id: "txn-1",
            completedAt: 100,
            storeId: "store-2",
          },
        ],
      }),
      {
        _id: "event-1",
        createdAt: 200,
        eventType: "pos_transaction_payment_method_corrected",
        posTransactionId: "txn-1",
        storeId: "store-1",
        subjectId: "txn-1",
        subjectType: "pos_transaction",
      } as never,
      { _id: "store-1", currency: "GHS" } as never,
    );

    expect(facts[0]).toMatchObject({
      businessEventKey: expect.stringContaining("source_incomplete"),
      limitingReason: "source_incomplete",
    });
    expect(facts[0]).not.toHaveProperty("exclusionReason");
  });

  it("seals canonical pending-checkout attribution on adjustment facts", async () => {
    const originalItem = {
      _id: "item-1",
      pendingCheckoutItemId: "pending-1",
      productId: "product-1",
      productSkuId: "sku-provisional",
      quantity: 2,
      totalPrice: 1_000,
      transactionId: "txn-1",
      unitPrice: 500,
    };
    const facts = await planPosAdjustmentRow(
      posPlanningCtx({
        adjustmentLines: [
          {
            _id: "line-1",
            adjustmentId: "adjustment-1",
            correctedQuantity: 1,
            correctedTotal: 500,
            inventoryDelta: 1,
            lineType: "existing",
            originalQuantity: 2,
            originalTransactionItemId: "item-1",
            originalTotal: 1_000,
            pendingCheckoutItemId: "pending-1",
            productId: "product-1",
            productSkuId: "sku-provisional",
            quantityDelta: -1,
            storeId: "store-1",
            transactionId: "txn-1",
            unitPrice: 500,
          },
        ],
        attributions: [
          {
            canonicalProductId: "product-canonical",
            canonicalProductSkuId: "sku-canonical",
            organizationId: "org-1",
            originalProductId: "product-1",
            originalProductSkuId: "sku-provisional",
            pendingCheckoutItemId: "pending-1",
            status: "completed",
            storeId: "store-1",
          },
        ],
        pendingItems: [
          {
            _id: "pending-1",
            organizationId: "org-1",
            provisionalProductId: "product-1",
            provisionalProductSkuId: "sku-provisional",
            status: "flagged",
            storeId: "store-1",
          },
        ],
        productSkus: [
          {
            _id: "sku-canonical",
            productId: "product-canonical",
            storeId: "store-1",
          },
        ],
        originalItems: [originalItem],
        transactions: [
          {
            _id: "txn-1",
            completedAt: 100,
            storeId: "store-1",
            subtotal: 1_000,
            tax: 0,
            total: 1_000,
          },
        ],
      }),
      {
        _id: "adjustment-1",
        appliedAt: 200,
        correctedSubtotal: 500,
        correctedTax: 0,
        correctedTotal: 500,
        currency: "GHS",
        deltaTotal: -500,
        originalSubtotal: 1_000,
        originalTax: 0,
        originalTotal: 1_000,
        storeId: "store-1",
        transactionId: "txn-1",
      } as never,
      { _id: "store-1", organizationId: "org-1" } as never,
    );

    expect(facts[0]).toEqual(
      expect.objectContaining({
        attributionKind: "pending_checkout",
        canonicalProductSkuId: "sku-canonical",
        originalProductSkuId: "sku-provisional",
        pendingCheckoutItemId: "pending-1",
        provisionalProductSkuId: "sku-provisional",
      }),
    );
  });

  it("rejects contradictory adjustment headers and cross-boundary lines", () => {
    const adjustment = {
      _id: "adjustment-1",
      appliedAt: 200,
      correctedSubtotal: 500,
      correctedTax: 50,
      correctedTotal: 550,
      deltaTotal: -550,
      originalSubtotal: 1_000,
      originalTax: 100,
      originalTotal: 1_100,
      storeId: "store-1",
      transactionId: "txn-1",
    };
    const line = {
      adjustmentId: "adjustment-1",
      correctedQuantity: 1,
      correctedTotal: 500,
      inventoryDelta: 1,
      lineType: "existing" as const,
      originalQuantity: 2,
      originalTransactionItemId: "item-1",
      originalTotal: 1_000,
      productId: "product-1",
      productSkuId: "sku-1",
      quantityDelta: -1,
      storeId: "store-1",
      transactionId: "txn-1",
      unitPrice: 500,
    };
    const originalItems = [
      {
        _id: "item-1",
        productId: "product-1",
        productSkuId: "sku-1",
        quantity: 2,
        totalPrice: 1_000,
        transactionId: "txn-1",
        unitPrice: 500,
      },
    ];
    const parentTransaction = {
      _id: "txn-1",
      completedAt: 100,
      storeId: "store-1",
      subtotal: 1_000,
      tax: 100,
      total: 1_100,
    };
    expect(
      posAdjustmentSourceIsCoherent({
        adjustment,
        lines: [line],
        originalItems,
        parentTransaction,
        productSkus: [],
      }),
    ).toBe(true);
    expect(
      posAdjustmentSourceIsCoherent({
        adjustment,
        lines: [
          line,
          {
            ...line,
            correctedQuantity: 1,
            correctedTotal: 500,
            inventoryDelta: 0,
            originalQuantity: 1,
            originalTransactionItemId: "item-2",
            originalTotal: 500,
            quantityDelta: 0,
          },
        ],
        originalItems: [
          ...originalItems,
          {
            ...originalItems[0]!,
            _id: "item-2",
            quantity: 1,
            totalPrice: 500,
          },
        ],
        parentTransaction,
        productSkus: [],
      }),
    ).toBe(true);
    expect(
      posAdjustmentSourceIsCoherent({
        adjustment: { ...adjustment, correctedTax: 0 },
        lines: [line],
        originalItems,
        parentTransaction,
        productSkus: [],
      }),
    ).toBe(false);
    expect(
      posAdjustmentSourceIsCoherent({
        adjustment: { ...adjustment, appliedAt: 99 },
        lines: [line],
        originalItems,
        parentTransaction,
        productSkus: [],
      }),
    ).toBe(false);
    expect(
      posAdjustmentSourceIsCoherent({
        adjustment,
        lines: [{ ...line, storeId: "store-2" }],
        originalItems,
        parentTransaction,
        productSkus: [],
      }),
    ).toBe(false);
    expect(
      posAdjustmentSourceIsCoherent({
        adjustment,
        lines: [{ ...line, quantityDelta: 99 }],
        originalItems,
        parentTransaction,
        productSkus: [],
      }),
    ).toBe(false);
    expect(
      posAdjustmentSourceIsCoherent({
        adjustment,
        lines: [{ ...line, productSkuId: "sku-wrong" }],
        originalItems,
        parentTransaction,
        productSkus: [],
      }),
    ).toBe(false);
    expect(
      posAdjustmentSourceIsCoherent({
        adjustment,
        lines: [line],
        originalItems,
        parentTransaction: { ...parentTransaction, subtotal: 999 },
        productSkus: [],
      }),
    ).toBe(false);
  });

  it("requires complete owned SKU attribution evidence", () => {
    const attribution = {
      canonicalProductId: "product-1",
      canonicalProductSkuId: "sku-1",
      organizationId: "org-1",
      originalProductId: "product-1",
      originalProductSkuId: "sku-1",
      pendingCheckoutItemId: "pending-1",
      storeId: "store-1",
    };
    const item = {
      pendingCheckoutItemId: "pending-1",
      productId: "product-1",
      productSkuId: "sku-1",
    };
    const input = {
      attribution,
      canonicalProduct: {
        _id: "product-1",
        organizationId: "org-1",
        storeId: "store-1",
      },
      canonicalSku: {
        _id: "sku-1",
        productId: "product-1",
        storeId: "store-1",
      },
      item,
      organizationId: "org-1",
      pendingItem: {
        _id: "pending-1",
        organizationId: "org-1",
        provisionalProductId: "product-1",
        provisionalProductSkuId: "sku-1",
        status: "flagged",
        storeId: "store-1",
      },
      storeId: "store-1",
    };
    expect(
      posSkuAttributionMatchesSourceItem(input),
    ).toBe(true);
    expect(
      posSkuAttributionMatchesSourceItem({
        ...input,
        attribution: { ...attribution, originalProductSkuId: "sku-stale" },
      }),
    ).toBe(false);
    expect(
      posSkuAttributionMatchesSourceItem({ ...input, pendingItem: null }),
    ).toBe(false);
  });

  it("rejects malformed primary sale units and cross-store attribution", () => {
    const item = {
      productId: "product-1",
      productSkuId: "sku-1",
      quantity: 2,
      totalPrice: 1_000,
      unitPrice: 500,
    };
    const evidence = {
      pending: null,
      product: { organizationId: "org-1", storeId: "store-1" },
      provisional: null,
      sku: { productId: "product-1", storeId: "store-1" },
    };
    const input = {
      itemEvidence: [evidence],
      items: [item],
      organizationId: "org-1",
      serviceCases: [],
      services: [],
      storeId: "store-1",
    };
    expect(posOriginalSaleSourceIsCoherent(input)).toBe(true);
    expect(
      posOriginalSaleSourceIsCoherent({
        ...input,
        items: [{ ...item, quantity: 99 }],
      }),
    ).toBe(false);
    expect(
      posOriginalSaleSourceIsCoherent({
        ...input,
        itemEvidence: [
          { ...evidence, sku: { ...evidence.sku, storeId: "store-2" } },
        ],
      }),
    ).toBe(false);
  });

  it("accepts either source tuple for a resolved pending-checkout alias", async () => {
    const item = {
      _id: "item-1",
      pendingCheckoutItemId: "pending-1",
      productId: "product-approved",
      productSkuId: "sku-approved",
      quantity: 2,
      totalPrice: 1_000,
      unitPrice: 500,
    };
    const pending = {
      _id: "pending-1",
      approvedProductId: "product-approved",
      approvedProductSkuId: "sku-approved",
      organizationId: "org-1",
      provisionalProductId: "product-provisional",
      provisionalProductSkuId: "sku-provisional",
      status: "linked_to_catalog",
      storeId: "store-1",
    };
    const evidence = {
      pending,
      product: { organizationId: "org-1", storeId: "store-1" },
      provisional: null,
      sku: { productId: "product-approved", storeId: "store-1" },
    };

    expect(
      posOriginalSaleSourceIsCoherent({
        itemEvidence: [evidence],
        items: [item],
        organizationId: "org-1",
        serviceCases: [],
        services: [],
        storeId: "store-1",
      }),
    ).toBe(true);
    expect(
      posOriginalSaleSourceIsCoherent({
        itemEvidence: [
          {
            ...evidence,
            pending: { ...pending, approvedProductSkuId: "sku-other" },
          },
        ],
        items: [item],
        organizationId: "org-1",
        serviceCases: [],
        services: [],
        storeId: "store-1",
      }),
    ).toBe(false);
    const provisionalItem = {
      ...item,
      productId: "product-provisional",
      productSkuId: "sku-provisional",
    };
    const provisionalEvidence = {
      ...evidence,
      product: { organizationId: "org-1", storeId: "store-1" },
      sku: { productId: "product-provisional", storeId: "store-1" },
    };
    expect(
      posOriginalSaleSourceIsCoherent({
        itemEvidence: [provisionalEvidence],
        items: [provisionalItem],
        organizationId: "org-1",
        serviceCases: [],
        services: [],
        storeId: "store-1",
      }),
    ).toBe(true);
    expect(
      posOriginalSaleSourceIsCoherent({
        itemEvidence: [
          {
            ...provisionalEvidence,
            pending: {
              ...pending,
              provisionalProductSkuId: "sku-other",
            },
          },
        ],
        items: [provisionalItem],
        organizationId: "org-1",
        serviceCases: [],
        services: [],
        storeId: "store-1",
      }),
    ).toBe(false);
    const richAttributionInput = {
      attribution: {
        canonicalProductId: "product-approved",
        canonicalProductSkuId: "sku-approved",
        organizationId: "org-1",
        originalProductId: "product-provisional",
        originalProductSkuId: "sku-provisional",
        pendingCheckoutItemId: "pending-1",
        storeId: "store-1",
      },
      canonicalProduct: {
        _id: "product-approved",
        organizationId: "org-1",
        storeId: "store-1",
      },
      canonicalSku: {
        _id: "sku-approved",
        productId: "product-approved",
        storeId: "store-1",
      },
      item,
      organizationId: "org-1",
      pendingItem: pending,
      storeId: "store-1",
    };
    expect(posSkuAttributionMatchesSourceItem(richAttributionInput)).toBe(true);
    const originalSourceInput = {
      ...richAttributionInput,
      item: {
        ...item,
        productId: "product-provisional",
        productSkuId: "sku-provisional",
      },
    };
    expect(posSkuAttributionMatchesSourceItem(originalSourceInput)).toBe(true);
    expect(
      posSkuAttributionMatchesSourceItem({
        ...originalSourceInput,
        pendingItem: {
          ...pending,
          approvedProductSkuId: "sku-other",
        },
      }),
    ).toBe(false);
    expect(
      posSkuAttributionMatchesSourceItem({
        ...richAttributionInput,
        attribution: {
          ...richAttributionInput.attribution,
          organizationId: "org-2",
        },
      }),
    ).toBe(false);
    expect(
      posSkuAttributionMatchesSourceItem({
        ...richAttributionInput,
        canonicalSku: {
          ...richAttributionInput.canonicalSku,
          storeId: "store-2",
        },
      }),
    ).toBe(false);
    expect(
      posOriginalSaleIdentityMode({
        sourceLineCount: 1,
        sourceLinesAreCoherent: true,
        total: 1_000,
      }),
    ).toBe("line");
    expect(
      posOriginalSaleIdentityMode({
        sourceLineCount: 1,
        sourceLinesAreCoherent: false,
        total: 1_000,
      }),
    ).toBe("transaction_summary");
    expect(
      posOriginalSaleIdentityMode({
        sourceLineCount: 100,
        sourceLinesAreCoherent: true,
        total: 1_000,
      }),
    ).toBe("line");
    expect(
      posOriginalSaleIdentityMode({
        sourceLineCount: 101,
        sourceLinesAreCoherent: true,
        total: 1_000,
      }),
    ).toBe("transaction_summary");

    const facts = await planPosRow(
      posPlanningCtx({
        attributions: [
          {
            canonicalProductId: "product-approved",
            canonicalProductSkuId: "sku-approved",
            organizationId: "org-1",
            originalProductId: "product-provisional",
            originalProductSkuId: "sku-provisional",
            pendingCheckoutItemId: "pending-1",
            status: "completed",
            storeId: "store-1",
          },
        ],
        items: [item],
        pendingItems: [pending],
      }),
      {
        _id: "txn-1",
        completedAt: 100,
        status: "completed",
        storeId: "store-1",
        tax: 0,
        total: 1_000,
      } as never,
      {
        _id: "store-1",
        currency: "GHS",
        organizationId: "org-1",
      } as never,
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      businessEventKey: "pos:txn-1:complete:line:item-1:sale",
      canonicalProductSkuId: "sku-approved",
      originalProductSkuId: "sku-provisional",
      productSkuId: "sku-approved",
      provisionalProductSkuId: "sku-provisional",
      quantity: 2,
    });
    const unattributedFacts = await planPosRow(
      posPlanningCtx({
        items: [provisionalItem],
        pendingItems: [pending],
      }),
      {
        _id: "txn-provisional",
        completedAt: 100,
        status: "completed",
        storeId: "store-1",
        tax: 0,
        total: 1_000,
      } as never,
      {
        _id: "store-1",
        currency: "GHS",
        organizationId: "org-1",
      } as never,
    );
    expect(unattributedFacts).toHaveLength(1);
    expect(unattributedFacts[0]).toMatchObject({
      businessEventKey:
        "pos:txn-provisional:complete:line:item-1:sale",
      originalProductSkuId: "sku-provisional",
      pendingCheckoutItemId: "pending-1",
      productSkuId: "sku-provisional",
      provisionalProductSkuId: "sku-provisional",
      quantity: 2,
    });
    expect(unattributedFacts[0]?.canonicalProductSkuId).toBeUndefined();
  });
  const approvedPolicy = {
    _id: "policy-1",
    approvalHash: "approval-hash-1",
    contentHash: "content-hash-1",
    intervalEnd: 1_000,
    intervalStart: 0,
    revenueCurrencyCode: "GHS",
    status: "approved",
  } as never;

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
      factContractVersion: 2,
      frozenWatermark: 200,
      metricContractVersion: 1,
      operation: "historical_backfill_preview",
      organizationId: "org-1",
      periodEnd: 200,
      periodStart: 100,
      projectionContractVersion: 2,
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
