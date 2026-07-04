import { describe, expect, it } from "vitest";

import { buildSkuActivityUntrustedSalesViewModel } from "./skuActivityUntrustedSalesAdapter";

describe("buildSkuActivityUntrustedSalesViewModel", () => {
  it("filters source rows and adapts selected transaction history", () => {
    const viewModel = buildSkuActivityUntrustedSalesViewModel(
      {
        hasMoreSources: false,
        reviewStatus: "open",
        sourceFilter: "all",
        sourceLimit: 50,
        totalSourceCount: 2,
        sources: [
          {
            evidence: {
              lastPosTransactionId: "transaction-1",
              lastSoldAt: 2_000,
              saleCount: 1,
              totalQuantitySold: 2,
            },
            id: "provisional-1",
            importKey: "legacy-import-1",
            lastActivityAt: 2_000,
            lookupCode: "BAR-18",
            productId: "product-1",
            productSkuId: "sku-1",
            reviewState: "open",
            reviewVersionNumber: 1,
            rowNumber: 12,
            sku: "LEG-18",
            sourceType: "inventoryImportProvisionalSku",
            status: "active",
            title: "Legacy closure wig",
            unitPrice: 120,
            updatedAt: 2_100,
          },
          {
            evidence: {
              lastPosTransactionId: "transaction-2",
              lastSoldAt: 2_500,
              observedLookupCodes: ["PEND-22"],
              observedPrices: [45],
              offlineSaleCount: 1,
              saleCount: 1,
              totalQuantitySold: 1,
            },
            id: "pending-1",
            lastActivityAt: 2_500,
            lookupCode: "PEND-22",
            reviewPriority: "elevated",
            reviewState: "open",
            sourceType: "posPendingCheckoutItem",
            status: "pending_review",
            title: "Pending checkout wig",
            unitPrice: 45,
            updatedAt: 2_550,
          },
        ],
        selected: {
          source: {
            evidence: {
              lastPosTransactionId: "transaction-1",
              lastSoldAt: 2_000,
              saleCount: 1,
              totalQuantitySold: 2,
            },
            id: "provisional-1",
            importKey: "legacy-import-1",
            lastActivityAt: 2_000,
            lookupCode: "BAR-18",
            productId: "product-1",
            productSkuId: "sku-1",
            reviewState: "open",
            reviewVersionNumber: 1,
            rowNumber: 12,
            sku: "LEG-18",
            sourceType: "inventoryImportProvisionalSku",
            status: "active",
            title: "Legacy closure wig",
            unitPrice: 120,
            updatedAt: 2_100,
          },
          transactionHistory: {
            isTruncated: false,
            rows: [
              {
                adjustments: {
                  appliedQuantityDelta: -1,
                  count: 1,
                  isTruncated: false,
                  latestAppliedAt: 2_200,
                  latestStatus: "applied",
                },
                completedAt: 2_000,
                id: "transaction-item-1",
                isRefunded: false,
                netQuantity: 1,
                productId: "product-1",
                productName: "Legacy closure wig",
                productSku: "LEG-18",
                productSkuId: "sku-1",
                quantity: 2,
                refundedAt: null,
                refundedQuantity: 0,
                totalPrice: 240,
                transactionId: "transaction-1",
                transactionNumber: "POS-1001",
                transactionStatus: "completed",
                unitPrice: 120,
              },
            ],
          },
        },
      },
      { selectedSourceId: "provisional-1", sourceFilter: "legacy_import" },
    );

    expect(viewModel).toMatchObject({
      reviewStatus: "open",
      sourceRows: [
        {
          evidenceLabel: "2 units across 1 sale",
          id: "provisional-1",
          isSelected: true,
          lookupLabel: "BAR-18 / LEG-18",
          reviewLabel: "Needs review",
          sourceTypeLabel: "Legacy import",
          statusLabel: "Active",
        },
      ],
      selected: {
        source: {
          id: "provisional-1",
          sourceTypeLabel: "Legacy import",
        },
        transactionRows: [
          {
            adjustmentLabel: "-1 applied adjustment",
            grossQuantity: 2,
            netQuantity: 1,
            productLabel: "Legacy closure wig (LEG-18)",
            receiptLabel: "#POS-1001",
            statusLabel: "Completed",
            transactionId: "transaction-1",
          },
        ],
      },
      summary: {
        openCount: 1,
        totalQuantitySold: 2,
        visibleSourceCount: 1,
      },
    });
  });
});
