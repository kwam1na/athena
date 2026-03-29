import { describe, expect, it } from "vitest";
import {
  formatDeliveryAddress,
  getDiscountValue,
  getOrderAmount,
  BagItem,
} from "./utils";
import { Discount } from "./types";

const sampleItems: BagItem[] = [
  { productSkuId: "sku-1", quantity: 2, price: 50 },
  { productSkuId: "sku-2", quantity: 1, price: 100 },
];

describe("getDiscountValue", () => {
  it("returns 0 when no discount is provided", () => {
    expect(getDiscountValue(sampleItems, null)).toBe(0);
    expect(getDiscountValue(sampleItems, undefined)).toBe(0);
  });

  describe("entire-order percentage discounts", () => {
    it("calculates percentage discount on the full subtotal", () => {
      const discount: Discount = {
        id: "d1",
        code: "SAVE10",
        type: "percentage",
        value: 10,
        span: "entire-order",
        isMultipleUses: false,
      };

      expect(getDiscountValue(sampleItems, discount)).toBe(20);
    });

    it("applies isInCents multiplier for percentage discounts", () => {
      const discount: Discount = {
        id: "d1",
        code: "SAVE10",
        type: "percentage",
        value: 10,
        span: "entire-order",
        isMultipleUses: false,
      };

      expect(getDiscountValue(sampleItems, discount, true)).toBe(2000);
    });
  });

  describe("entire-order amount discounts", () => {
    it("applies fixed amount discount directly", () => {
      const discount: Discount = {
        id: "d2",
        code: "FLAT25",
        type: "amount",
        value: 25,
        span: "entire-order",
        isMultipleUses: false,
      };

      expect(getDiscountValue(sampleItems, discount)).toBe(25);
    });

    it("applies isInCents multiplier for amount discounts", () => {
      const discount: Discount = {
        id: "d2",
        code: "FLAT25",
        type: "amount",
        value: 25,
        span: "entire-order",
        isMultipleUses: false,
      };

      expect(getDiscountValue(sampleItems, discount, true)).toBe(2500);
    });
  });

  describe("selected-products percentage discounts", () => {
    it("applies percentage only to eligible items", () => {
      const discount: Discount = {
        id: "d3",
        code: "SKU1SAVE",
        type: "percentage",
        value: 50,
        span: "selected-products",
        isMultipleUses: false,
        productSkus: ["sku-1"],
      };

      expect(getDiscountValue(sampleItems, discount)).toBe(50);
    });
  });

  describe("selected-products amount discounts", () => {
    it("caps amount discount at eligible items subtotal", () => {
      const discount: Discount = {
        id: "d4",
        code: "BIGDISCOUNT",
        type: "amount",
        value: 500,
        span: "selected-products",
        isMultipleUses: false,
        productSkus: ["sku-1"],
      };

      expect(getDiscountValue(sampleItems, discount)).toBe(100);
    });

    it("applies full amount when less than eligible subtotal", () => {
      const discount: Discount = {
        id: "d5",
        code: "SMALL",
        type: "amount",
        value: 10,
        span: "selected-products",
        isMultipleUses: false,
        productSkus: ["sku-1"],
      };

      expect(getDiscountValue(sampleItems, discount)).toBe(10);
    });
  });

  it("returns 0 for selected-products discount with no productSkus", () => {
    const discount: Discount = {
      id: "d6",
      code: "NOSKUS",
      type: "percentage",
      value: 10,
      span: "selected-products",
      isMultipleUses: false,
    };

    expect(getDiscountValue(sampleItems, discount)).toBe(0);
  });
});

describe("getOrderAmount", () => {
  it("calculates order amount with no discount and no delivery fee", () => {
    const result = getOrderAmount({
      items: sampleItems,
      discount: null,
      deliveryFee: null,
      subtotal: 200,
    });

    expect(result.amountCharged).toBe(200);
    expect(result.amountPaid).toBe(200);
    expect(result.discountValue).toBe(0);
  });

  it("includes delivery fee in amountCharged but not amountPaid", () => {
    const result = getOrderAmount({
      items: sampleItems,
      discount: null,
      deliveryFee: 30,
      subtotal: 200,
    });

    expect(result.amountCharged).toBe(230);
    expect(result.amountPaid).toBe(200);
  });

  it("subtracts discount from both amountCharged and amountPaid", () => {
    const discount: Discount = {
      id: "d1",
      code: "SAVE10",
      type: "percentage",
      value: 10,
      span: "entire-order",
      isMultipleUses: false,
    };

    const result = getOrderAmount({
      items: sampleItems,
      discount,
      deliveryFee: 30,
      subtotal: 200,
    });

    expect(result.discountValue).toBe(20);
    expect(result.amountCharged).toBe(210);
    expect(result.amountPaid).toBe(180);
  });
});

describe("formatDeliveryAddress", () => {
  it("formats US addresses with address, city, state, zip", () => {
    const result = formatDeliveryAddress({
      country: "US",
      address: "123 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
    });

    expect(result.addressLine).toBe("123 Main St, Austin, TX, 78701");
    expect(result.country).toBe("United States");
  });

  it("formats international addresses with address and city", () => {
    const result = formatDeliveryAddress({
      country: "GB",
      address: "10 Downing St",
      city: "London",
    });

    expect(result.addressLine).toBe("10 Downing St, London");
    expect(result.country).toBe("United Kingdom");
  });

  it("formats Ghana addresses with house number, street, neighborhood and region", () => {
    const result = formatDeliveryAddress({
      country: "GH",
      houseNumber: "15",
      street: "Oxford Street",
      neighborhood: "osu",
      region: "GA",
    });

    expect(result.addressLine).toContain("15");
    expect(result.addressLine).toContain("Oxford Street");
  });

  it("handles Ghana address without house number", () => {
    const result = formatDeliveryAddress({
      country: "GH",
      street: "Oxford Street",
      neighborhood: "osu",
      region: "GA",
    });

    expect(result.addressLine).toContain("Oxford Street");
    expect(result.addressLine).not.toMatch(/^\s/);
  });
});
