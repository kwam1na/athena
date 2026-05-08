import { describe, expect, it } from "vitest";
import {
  applyOperation,
  calculatePriceWithFee,
  computePreview,
  parseOperationValue,
  validateOperationValue,
  type SkuRow,
} from "./useBulkOperations";
import type { Id } from "~/convex/_generated/dataModel";

// --- applyOperation ---

describe("applyOperation", () => {
  describe("multiply", () => {
    it("multiplies the price by the given value", () => {
      expect(applyOperation("multiply", 10000, 2)).toBe(20000);
    });

    it("handles decimal multipliers", () => {
      expect(applyOperation("multiply", 10000, 0.5)).toBe(5000);
    });

    it("returns null for zero value", () => {
      expect(applyOperation("multiply", 100, 0)).toBeNull();
    });

    it("returns null for negative value", () => {
      expect(applyOperation("multiply", 100, -1)).toBeNull();
    });
  });

  describe("divide", () => {
    it("divides the price by the given value", () => {
      expect(applyOperation("divide", 20000, 2)).toBe(10000);
    });

    it("handles division resulting in decimals", () => {
      expect(applyOperation("divide", 10000, 3)).toBeCloseTo(3333.333, 2);
    });

    it("returns null for zero value (divide by zero)", () => {
      expect(applyOperation("divide", 100, 0)).toBeNull();
    });

    it("returns null for negative value", () => {
      expect(applyOperation("divide", 100, -2)).toBeNull();
    });
  });

  describe("set", () => {
    it("sets the price to the given value", () => {
      expect(applyOperation("set", 10000, 5000)).toBe(5000);
    });

    it("allows setting to zero", () => {
      expect(applyOperation("set", 100, 0)).toBe(0);
    });
  });

  describe("increase_percent", () => {
    it("increases price by percentage", () => {
      expect(applyOperation("increase_percent", 10000, 15)).toBeCloseTo(11500);
    });

    it("handles 100% increase", () => {
      expect(applyOperation("increase_percent", 5000, 100)).toBe(10000);
    });
  });

  describe("decrease_percent", () => {
    it("decreases price by percentage", () => {
      expect(applyOperation("decrease_percent", 10000, 25)).toBe(7500);
    });

    it("handles 100% decrease (results in zero)", () => {
      expect(applyOperation("decrease_percent", 10000, 100)).toBe(0);
    });

    it("can result in negative for >100% decrease", () => {
      expect(applyOperation("decrease_percent", 10000, 150)).toBe(-5000);
    });
  });

  describe("increase_fixed", () => {
    it("adds a fixed amount to the price", () => {
      expect(applyOperation("increase_fixed", 10000, 2000)).toBe(12000);
    });
  });

  describe("decrease_fixed", () => {
    it("subtracts a fixed amount from the price", () => {
      expect(applyOperation("decrease_fixed", 10000, 2000)).toBe(8000);
    });

    it("can result in negative", () => {
      expect(applyOperation("decrease_fixed", 1000, 2000)).toBe(-1000);
    });
  });
});

// --- calculatePriceWithFee ---

describe("calculatePriceWithFee", () => {
  it("returns the net price when fees are absorbed", () => {
    expect(calculatePriceWithFee(10000, true)).toBe(10000);
  });

  it("adds processing fee when not absorbed", () => {
    // PAYSTACK_PROCESSING_FEE is 1.95%
    // 100 + (100 * 1.95 / 100) = 100 + 1.95 = 101.95, rounded to 102
    expect(calculatePriceWithFee(10000, false)).toBe(10200);
  });

  it("rounds the fee result", () => {
    // 50 + (50 * 1.95 / 100) = 50 + 0.975 = 50.975, rounded to 51
    expect(calculatePriceWithFee(5000, false)).toBe(5100);
  });

  it("handles zero price", () => {
    expect(calculatePriceWithFee(0, false)).toBe(0);
    expect(calculatePriceWithFee(0, true)).toBe(0);
  });
});

describe("parseOperationValue", () => {
  it("parses money operations as display amounts into pesewas", () => {
    expect(parseOperationValue("set", "12.34")).toBe(1234);
    expect(parseOperationValue("increase_fixed", "0.75")).toBe(75);
    expect(parseOperationValue("decrease_fixed", "GHS 1,234.56")).toBe(123456);
  });

  it("leaves raw numeric operations as raw numbers", () => {
    expect(parseOperationValue("multiply", "1.075")).toBe(1.075);
    expect(parseOperationValue("divide", "2")).toBe(2);
    expect(parseOperationValue("increase_percent", "12.5")).toBe(12.5);
  });

  it("rejects invalid and negative money operation values", () => {
    expect(parseOperationValue("set", "-12")).toBeUndefined();
    expect(parseOperationValue("increase_fixed", "not an amount")).toBeUndefined();
  });
});

// --- validateOperationValue ---

describe("validateOperationValue", () => {
  it("returns null for valid multiply value", () => {
    expect(validateOperationValue("multiply", 2)).toBeNull();
  });

  it("returns error for zero multiply value", () => {
    expect(validateOperationValue("multiply", 0)).toBe(
      "Value must be greater than 0"
    );
  });

  it("returns error for negative divide value", () => {
    expect(validateOperationValue("divide", -1)).toBe(
      "Value must be greater than 0"
    );
  });

  it("returns error for NaN", () => {
    expect(validateOperationValue("set", NaN)).toBe(
      "Please enter a valid amount"
    );
  });

  it("returns error for negative set value", () => {
    expect(validateOperationValue("set", -5)).toBe("Price cannot be negative");
  });

  it("allows zero for set", () => {
    expect(validateOperationValue("set", 0)).toBeNull();
  });

  it("allows any value for increase/decrease operations", () => {
    expect(validateOperationValue("increase_percent", 50)).toBeNull();
    expect(validateOperationValue("decrease_percent", 50)).toBeNull();
    expect(validateOperationValue("increase_fixed", 10)).toBeNull();
    expect(validateOperationValue("decrease_fixed", 10)).toBeNull();
  });
});

// --- computePreview ---

describe("computePreview", () => {
  const makeSku = (
    overrides: Partial<SkuRow> = {}
  ): SkuRow => ({
    skuId: "test-sku-1" as Id<"productSku">,
    productName: "Test Product",
    sku: "SKU-001",
    currentPricePesewas: 10000, // 100.00 display
    currentNetPricePesewas: 10000,
    areProcessingFeesAbsorbed: true,
    ...overrides,
  });

  it("computes correct preview for multiply operation", () => {
    const skus = [makeSku()];
    const result = computePreview(skus, "multiply", 2);

    expect(result).toHaveLength(1);
    // 100 * 2 = 200 display = 20000 pesewas
    expect(result[0].newNetPricePesewas).toBe(20000);
    expect(result[0].hasWarning).toBe(false);
  });

  it("computes correct preview for divide operation", () => {
    const skus = [makeSku()];
    const result = computePreview(skus, "divide", 100);

    // 100 / 100 = 1.00 display = 100 pesewas
    expect(result[0].newNetPricePesewas).toBe(100);
    expect(result[0].hasWarning).toBe(false);
  });

  it("computes correct preview for set operation from a parsed money value", () => {
    const skus = [makeSku()];
    const result = computePreview(skus, "set", 5000);

    // Set to 50 display = 5000 pesewas
    expect(result[0].newNetPricePesewas).toBe(5000);
    expect(result[0].hasWarning).toBe(false);
  });

  it("flags negative results with warning", () => {
    const skus = [makeSku({ currentNetPricePesewas: 1000 })]; // 10.00 display
    const result = computePreview(skus, "decrease_fixed", 2000);

    // 10 - 20 = -10 display = -1000 pesewas
    expect(result[0].newNetPricePesewas).toBe(-1000);
    expect(result[0].hasWarning).toBe(true);
  });

  it("flags zero results with warning", () => {
    const skus = [makeSku()];
    const result = computePreview(skus, "decrease_percent", 100);

    // 100 - 100% = 0
    expect(result[0].newNetPricePesewas).toBe(0);
    expect(result[0].hasWarning).toBe(true);
  });

  it("applies processing fees when not absorbed", () => {
    const skus = [makeSku({ areProcessingFeesAbsorbed: false })];
    const result = computePreview(skus, "set", 10000);

    // netPrice = 100 display = 10000 pesewas
    expect(result[0].newNetPricePesewas).toBe(10000);
    // price = 100 + 1.95% = 101.95 rounded to 102 = 10200 pesewas
    expect(result[0].newPricePesewas).toBe(10200);
  });

  it("handles multiple SKUs", () => {
    const skus = [
      makeSku({
        skuId: "sku-1" as Id<"productSku">,
        currentNetPricePesewas: 10000,
      }),
      makeSku({
        skuId: "sku-2" as Id<"productSku">,
        currentNetPricePesewas: 20000,
      }),
    ];
    const result = computePreview(skus, "multiply", 2);

    expect(result).toHaveLength(2);
    expect(result[0].newNetPricePesewas).toBe(20000);
    expect(result[1].newNetPricePesewas).toBe(40000);
  });

  it("handles invalid operation (divide by zero)", () => {
    const skus = [makeSku()];
    const result = computePreview(skus, "divide", 0);

    expect(result[0].hasWarning).toBe(true);
    // Falls back to current prices
    expect(result[0].newNetPricePesewas).toBe(10000);
  });
});
