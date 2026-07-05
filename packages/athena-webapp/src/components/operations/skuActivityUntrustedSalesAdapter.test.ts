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
            title: "LEGACY CLOSURE WIG",
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
            title: "LEGACY CLOSURE WIG",
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
                productName: "LEGACY CLOSURE WIG",
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
              {
                adjustments: {
                  appliedQuantityDelta: 0,
                  count: 1,
                  isTruncated: false,
                  latestAppliedAt: 2_300,
                  latestStatus: "applied",
                },
                completedAt: 2_250,
                id: "transaction-item-2",
                isRefunded: false,
                netQuantity: 1,
                productId: "product-1",
                productName: "LEGACY CLOSURE WIG",
                productSku: "LEG-18",
                productSkuId: "sku-1",
                quantity: 1,
                refundedAt: null,
                refundedQuantity: 0,
                totalPrice: 120,
                transactionId: "transaction-2",
                transactionNumber: "POS-1002",
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
          title: "Legacy Closure Wig",
        },
      ],
      selected: {
        source: {
          id: "provisional-1",
          sourceTypeLabel: "Legacy import",
          title: "Legacy Closure Wig",
        },
        transactionRows: [
          {
            adjustmentLabel: "-1 applied adjustment",
            grossQuantity: 2,
            netQuantity: 1,
            productLabel: "Legacy Closure Wig (LEG-18)",
            receiptLabel: "#POS-1001",
            statusLabel: "Completed",
            transactionId: "transaction-1",
          },
          {
            adjustmentLabel: null,
            grossQuantity: 1,
            netQuantity: 1,
            productLabel: "Legacy Closure Wig (LEG-18)",
            receiptLabel: "#POS-1002",
            statusLabel: "Completed",
            transactionId: "transaction-2",
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

  it("does not attach stale selected details to a newly selected source row", () => {
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
              totalQuantitySold: 1,
            },
            id: "provisional-1",
            lastActivityAt: 2_000,
            lookupCode: "BAR-18",
            productId: "product-1",
            productSkuId: "sku-1",
            reviewState: "open",
            sku: "LEG-18",
            sourceType: "inventoryImportProvisionalSku",
            status: "active",
            title: "Legacy closure wig",
            updatedAt: 2_100,
          },
          {
            evidence: {
              lastPosTransactionId: "transaction-2",
              lastSoldAt: 2_500,
              saleCount: 1,
              totalQuantitySold: 1,
            },
            id: "provisional-2",
            lastActivityAt: 2_500,
            lookupCode: "BAR-22",
            productId: "product-2",
            productSkuId: "sku-2",
            reviewState: "open",
            sku: "LEG-22",
            sourceType: "inventoryImportProvisionalSku",
            status: "active",
            title: "Newly selected wig",
            updatedAt: 2_600,
          },
        ],
        selected: {
          source: {
            evidence: {
              lastPosTransactionId: "transaction-1",
              lastSoldAt: 2_000,
              saleCount: 1,
              totalQuantitySold: 1,
            },
            id: "provisional-1",
            lastActivityAt: 2_000,
            lookupCode: "BAR-18",
            productId: "product-1",
            productSkuId: "sku-1",
            reviewState: "open",
            sku: "LEG-18",
            sourceType: "inventoryImportProvisionalSku",
            status: "active",
            title: "Legacy closure wig",
            updatedAt: 2_100,
          },
          transactionHistory: {
            isTruncated: false,
            rows: [],
          },
        },
      },
      { selectedSourceId: "provisional-2" },
    );

    expect(viewModel?.selected).toBeNull();
    expect(viewModel?.sourceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "provisional-2",
          isSelected: true,
        }),
      ]),
    );
  });
});
