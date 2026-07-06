import { describe, expect, it } from "vitest";

import {
  classifyProvisionalImportLineage,
  findMixedTrustedAndProvisionalSkuId,
  shouldRecordProvisionalImportSaleEvidence,
} from "./projectionPolicies";
import type { PosLocalSaleItemInput } from "./types";

describe("POS sync projection policies", () => {
  it("keeps active provisional rows as evidence-only sale lines", () => {
    const item = saleItem({
      inventoryImportProvisionalSkuId: "provisional-import-sku-1",
    });
    const result = classifyProvisionalImportLineage({
      item,
      provisionalImportSku: {
        _id: "provisional-import-sku-1",
        storeId: "store-1" as never,
        status: "active",
        posExposureStatus: "available",
        productId: "product-1" as never,
        productSkuId: "sku-1" as never,
        importedPrice: 25,
      },
      saleOccurredAt: 20,
      storeId: "store-1" as never,
    });

    expect(result).toMatchObject({
      kind: "accepted",
      linePolicy: {
        source: "active_provisional_import",
        stockMutationPolicy: "record_provisional_evidence",
      },
      priceBasis: "provisional_import",
    });
    if (result.kind === "accepted") {
      expect(
        shouldRecordProvisionalImportSaleEvidence(
          item,
          new Map([["local-txn-item-1", result.linePolicy]]),
        ),
      ).toBe(true);
    }
  });

  it("treats finalized provisional lineage as trusted demand with trusted SKU pricing", () => {
    const result = classifyProvisionalImportLineage({
      item: saleItem({
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
      }),
      provisionalImportSku: {
        _id: "provisional-import-sku-1",
        storeId: "store-1" as never,
        status: "finalized",
        posExposureStatus: "hidden",
        productId: "product-1" as never,
        productSkuId: "sku-1" as never,
        importedPrice: 99,
        finalizedAt: 10,
      },
      saleOccurredAt: 20,
      storeId: "store-1" as never,
    });

    expect(result).toMatchObject({
      kind: "accepted",
      linePolicy: {
        source: "finalized_provisional_lineage",
        stockMutationPolicy: "mutate_trusted_stock",
      },
      priceBasis: "trusted_sku",
    });
  });

  it("skips stock mutation when the sale happened before provisional finalization", () => {
    const result = classifyProvisionalImportLineage({
      item: saleItem({
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
      }),
      provisionalImportSku: {
        _id: "provisional-import-sku-1",
        storeId: "store-1" as never,
        status: "finalized",
        posExposureStatus: "hidden",
        productId: "product-1" as never,
        productSkuId: "sku-1" as never,
        importedPrice: 25,
        finalizedAt: 30,
      },
      saleOccurredAt: 20,
      storeId: "store-1" as never,
    });

    expect(result).toMatchObject({
      kind: "accepted",
      linePolicy: {
        source: "finalized_provisional_lineage",
        stockMutationPolicy: "skip_stock_mutation",
        skipStockMutationReason: "finalized_lineage_before_finalization",
      },
    });
  });

  it("skips stock mutation when finalized lineage lacks a finalization timestamp", () => {
    const result = classifyProvisionalImportLineage({
      item: saleItem({
        inventoryImportProvisionalSkuId: "provisional-import-sku-1",
      }),
      provisionalImportSku: {
        _id: "provisional-import-sku-1",
        storeId: "store-1" as never,
        status: "finalized",
        posExposureStatus: "hidden",
        productId: "product-1" as never,
        productSkuId: "sku-1" as never,
        importedPrice: 25,
      },
      saleOccurredAt: 20,
      storeId: "store-1" as never,
    });

    expect(result).toMatchObject({
      kind: "accepted",
      linePolicy: {
        source: "finalized_provisional_lineage",
        stockMutationPolicy: "skip_stock_mutation",
        skipStockMutationReason: "finalized_lineage_before_finalization",
      },
    });
  });

  it.each([
    ["missing", null],
    [
      "store_mismatch",
      {
        _id: "provisional-import-sku-1",
        storeId: "store-2" as never,
        status: "active" as const,
        posExposureStatus: "available" as const,
        productId: "product-1" as never,
        productSkuId: "sku-1" as never,
        importedPrice: 25,
      },
    ],
    [
      "product_mismatch",
      {
        _id: "provisional-import-sku-1",
        storeId: "store-1" as never,
        status: "active" as const,
        posExposureStatus: "available" as const,
        productId: "product-2" as never,
        productSkuId: "sku-1" as never,
        importedPrice: 25,
      },
    ],
    [
      "sku_mismatch",
      {
        _id: "provisional-import-sku-1",
        storeId: "store-1" as never,
        status: "active" as const,
        posExposureStatus: "available" as const,
        productId: "product-1" as never,
        productSkuId: "sku-2" as never,
        importedPrice: 25,
      },
    ],
    [
      "hidden_active_provisional",
      {
        _id: "provisional-import-sku-1",
        storeId: "store-1" as never,
        status: "active" as const,
        posExposureStatus: "hidden" as const,
        productId: "product-1" as never,
        productSkuId: "sku-1" as never,
        importedPrice: 25,
      },
    ],
    [
      "inactive",
      {
        _id: "provisional-import-sku-1",
        storeId: "store-1" as never,
        status: "rejected" as const,
        productId: "product-1" as never,
        productSkuId: "sku-1" as never,
        importedPrice: 25,
      },
    ],
    [
      "inactive",
      {
        _id: "provisional-import-sku-1",
        storeId: "store-1" as never,
        status: "closed" as const,
        productId: "product-1" as never,
        productSkuId: "sku-1" as never,
        importedPrice: 25,
      },
    ],
  ])("classifies invalid provisional lineage as %s", (reason, row) => {
    expect(
      classifyProvisionalImportLineage({
        item: saleItem({
          inventoryImportProvisionalSkuId: "provisional-import-sku-1",
        }),
        provisionalImportSku: row,
        saleOccurredAt: 20,
        storeId: "store-1" as never,
      }),
    ).toEqual({ kind: "invalid", reason });
  });

  it("only flags active provisional rows as mixed with trusted same-SKU demand", () => {
    const finalizedLine = saleItem({
      inventoryImportProvisionalSkuId: "provisional-import-sku-1",
    });
    const trustedLine = saleItem({
      localTransactionItemId: "local-trusted-line-1",
    });
    const activeProvisionalLine = saleItem({
      inventoryImportProvisionalSkuId: "provisional-import-sku-2",
      localTransactionItemId: "local-provisional-line-2",
    });

    expect(
      findMixedTrustedAndProvisionalSkuId(
        [finalizedLine, trustedLine],
        new Map([
          [
            "local-txn-item-1",
            {
              source: "finalized_provisional_lineage",
              stockMutationPolicy: "mutate_trusted_stock",
            },
          ],
        ]),
      ),
    ).toBeNull();
    expect(
      findMixedTrustedAndProvisionalSkuId(
        [activeProvisionalLine, trustedLine],
        new Map([
          [
            "local-provisional-line-2",
            {
              source: "active_provisional_import",
              stockMutationPolicy: "record_provisional_evidence",
            },
          ],
        ]),
      ),
    ).toBe("sku-1");
  });

  it("separates same-SKU line policies when local transaction item ids are absent", () => {
    const activeProvisionalLine = saleItem({
      inventoryImportProvisionalSkuId: "provisional-import-sku-1",
      localTransactionItemId: undefined,
    });
    const finalizedLine = saleItem({
      inventoryImportProvisionalSkuId: "provisional-import-sku-2",
      localTransactionItemId: undefined,
    });

    expect(
      findMixedTrustedAndProvisionalSkuId(
        [activeProvisionalLine, finalizedLine],
        new Map([
          [
            "sku-1:0",
            {
              source: "active_provisional_import",
              stockMutationPolicy: "record_provisional_evidence",
            },
          ],
          [
            "sku-1:1",
            {
              source: "finalized_provisional_lineage",
              stockMutationPolicy: "mutate_trusted_stock",
            },
          ],
        ]),
      ),
    ).toBe("sku-1");
  });
});

function saleItem(
  overrides: Partial<PosLocalSaleItemInput> = {},
): PosLocalSaleItemInput {
  return {
    localTransactionItemId: "local-txn-item-1",
    productId: "product-1" as never,
    productSkuId: "sku-1" as never,
    productName: "Wig Cap",
    productSku: "CAP-1",
    quantity: 1,
    unitPrice: 25,
    ...overrides,
  };
}
