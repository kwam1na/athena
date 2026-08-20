import { describe, expect, it } from "vitest";

import {
  buildManagerReportExpenseSections,
  rankManagerReportExpenseProducts,
} from "./managerReportExpenseSections";

describe("manager report expense sections", () => {
  it("ranks five rows deterministically and aggregates the remainder", () => {
    const ranked = rankManagerReportExpenseProducts(
      Array.from({ length: 6 }, (_, index) => ({
        productName: `Product ${index + 1}`,
        productSku: `SKU-${index + 1}`,
        productSkuId: `sku-${index + 1}`,
        quantity: index + 1,
        spendMinor: (index + 1) * 100,
      })),
    );

    expect(ranked.bySpend.map((row) => row.productSkuId)).toEqual([
      "sku-6",
      "sku-5",
      "sku-4",
      "sku-3",
      "sku-2",
    ]);
    expect(ranked.spendRemainder).toEqual({
      productCount: 1,
      quantity: 1,
      spendMinor: 100,
    });
    expect(ranked.byQuantity.map((row) => row.productSkuId)).toEqual([
      "sku-6",
      "sku-5",
      "sku-4",
      "sku-3",
      "sku-2",
    ]);
    expect(ranked.quantityRemainder).toEqual({
      productCount: 1,
      quantity: 1,
      spendMinor: 100,
    });

    const [spendSection] = buildManagerReportExpenseSections(
      ranked,
      (minor) => `GHS ${minor}`,
    );
    expect(spendSection?.remainder).toEqual({
      label: "1 other product",
      primary: "GHS 100",
      secondary: "1 unit",
    });
  });

  it("uses SKU identity as the stable final tie-break", () => {
    const ranked = rankManagerReportExpenseProducts([
      {
        productName: "Second",
        productSku: "B",
        productSkuId: "sku-b",
        quantity: 1,
        spendMinor: 100,
      },
      {
        productName: "First",
        productSku: "A",
        productSkuId: "sku-a",
        quantity: 1,
        spendMinor: 100,
      },
    ]);

    expect(ranked.bySpend.map((row) => row.productSkuId)).toEqual([
      "sku-a",
      "sku-b",
    ]);
  });

  it("ranks quantity independently from spend and aggregates its remainder", () => {
    const ranked = rankManagerReportExpenseProducts([
      {
        productName: "A",
        productSku: "A",
        productSkuId: "sku-a",
        quantity: 8,
        spendMinor: 100,
      },
      {
        productName: "B",
        productSku: "B",
        productSkuId: "sku-b",
        quantity: 2,
        spendMinor: 900,
      },
      {
        productName: "C",
        productSku: "C",
        productSkuId: "sku-c",
        quantity: 7,
        spendMinor: 200,
      },
      {
        productName: "D",
        productSku: "D",
        productSkuId: "sku-d",
        quantity: 3,
        spendMinor: 800,
      },
      {
        productName: "E",
        productSku: "E",
        productSkuId: "sku-e",
        quantity: 6,
        spendMinor: 300,
      },
      {
        productName: "F",
        productSku: "F",
        productSkuId: "sku-f",
        quantity: 4,
        spendMinor: 700,
      },
    ]);

    expect(ranked.byQuantity.map((row) => row.productSkuId)).toEqual([
      "sku-a",
      "sku-c",
      "sku-e",
      "sku-f",
      "sku-d",
    ]);
    expect(ranked.quantityRemainder).toEqual({
      productCount: 1,
      quantity: 2,
      spendMinor: 900,
    });
  });
});
