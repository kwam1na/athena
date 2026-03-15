import { describe, expect, it, vi } from "vitest";

vi.mock("@athena/webapp", () => ({}));

import { getDiscountValue, getOrderAmount, formatDeliveryAddress } from "./utils";
import type { BagItem } from "./utils";
import type { Discount } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const items: BagItem[] = [
  { productSkuId: "sku-1", quantity: 2, price: 100 },
  { productSkuId: "sku-2", quantity: 1, price: 50 },
];
// subtotal = 2*100 + 1*50 = 250

// ---------------------------------------------------------------------------
// getDiscountValue
// ---------------------------------------------------------------------------

describe("getDiscountValue", () => {
  it("returns 0 when no discount is provided", () => {
    expect(getDiscountValue(items)).toBe(0);
    expect(getDiscountValue(items, null)).toBe(0);
  });

  describe("entire-order span", () => {
    it("calculates percentage discount on full subtotal", () => {
      const discount: Discount = {
        id: "d1",
        code: "SAVE10",
        type: "percentage",
        value: 10,
        span: "entire-order",
        isMultipleUses: false,
      };
      // 10% of 250 = 25
      expect(getDiscountValue(items, discount)).toBe(25);
    });

    it("calculates fixed amount discount on full order", () => {
      const discount: Discount = {
        id: "d2",
        code: "FLAT20",
        type: "amount",
        value: 20,
        span: "entire-order",
        isMultipleUses: false,
      };
      expect(getDiscountValue(items, discount)).toBe(20);
    });

    it("multiplies by 100 when isInCents is true", () => {
      const discount: Discount = {
        id: "d3",
        code: "SAVE10",
        type: "percentage",
        value: 10,
        span: "entire-order",
        isMultipleUses: false,
      };
      // 10% of 250 = 25, * 100 = 2500
      expect(getDiscountValue(items, discount, true)).toBe(2500);
    });
  });

  describe("selected-products span", () => {
    it("applies percentage only to eligible items", () => {
      const discount: Discount = {
        id: "d4",
        code: "SKU1OFF",
        type: "percentage",
        value: 20,
        span: "selected-products",
        productSkus: ["sku-1"],
        isMultipleUses: false,
      };
      // eligible subtotal = 2 * 100 = 200; 20% of 200 = 40
      expect(getDiscountValue(items, discount)).toBe(40);
    });

    it("caps fixed-amount discount at the eligible subtotal", () => {
      const discount: Discount = {
        id: "d5",
        code: "BIG",
        type: "amount",
        value: 999,
        span: "selected-products",
        productSkus: ["sku-2"],
        isMultipleUses: false,
      };
      // eligible subtotal = 50; discount capped at 50
      expect(getDiscountValue(items, discount)).toBe(50);
    });

    it("applies fixed-amount discount when it is less than eligible subtotal", () => {
      const discount: Discount = {
        id: "d6",
        code: "SMALL",
        type: "amount",
        value: 10,
        span: "selected-products",
        productSkus: ["sku-2"],
        isMultipleUses: false,
      };
      // eligible subtotal = 50; discount = 10
      expect(getDiscountValue(items, discount)).toBe(10);
    });

    it("returns 0 when no items match the selected productSkus", () => {
      const discount: Discount = {
        id: "d7",
        code: "NONE",
        type: "percentage",
        value: 50,
        span: "selected-products",
        productSkus: ["sku-999"],
        isMultipleUses: false,
      };
      expect(getDiscountValue(items, discount)).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// getOrderAmount
// ---------------------------------------------------------------------------

describe("getOrderAmount", () => {
  it("returns correct amounts with no discount and no delivery fee", () => {
    const { amountCharged, discountValue, amountPaid } = getOrderAmount({
      items,
      discount: null,
      deliveryFee: null,
      subtotal: 250,
    });
    expect(discountValue).toBe(0);
    expect(amountPaid).toBe(250);
    expect(amountCharged).toBe(250);
  });

  it("adds delivery fee to amountCharged but not amountPaid", () => {
    const { amountCharged, amountPaid } = getOrderAmount({
      items,
      discount: null,
      deliveryFee: 30,
      subtotal: 250,
    });
    expect(amountCharged).toBe(280);
    expect(amountPaid).toBe(250);
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
    const { amountCharged, discountValue, amountPaid } = getOrderAmount({
      items,
      discount,
      deliveryFee: 30,
      subtotal: 250,
    });
    // discountValue = 25, amountPaid = 225, amountCharged = 225 + 30 = 255
    expect(discountValue).toBe(25);
    expect(amountPaid).toBe(225);
    expect(amountCharged).toBe(255);
  });

  it("treats null delivery fee as 0", () => {
    const { amountCharged } = getOrderAmount({
      items,
      discount: null,
      deliveryFee: null,
      subtotal: 250,
    });
    expect(amountCharged).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// formatDeliveryAddress
// ---------------------------------------------------------------------------

describe("formatDeliveryAddress", () => {
  it("returns empty strings for a falsy address", () => {
    const result = formatDeliveryAddress(null as any);
    expect(result.addressLine).toBe("");
    expect(result.country).toBe("");
  });

  it("formats a US address correctly", () => {
    const { addressLine, country } = formatDeliveryAddress({
      address: "123 Main St",
      city: "San Francisco",
      state: "CA",
      zip: "94105",
      country: "US",
    });
    expect(addressLine).toBe("123 Main St, San Francisco, CA, 94105");
    expect(country).toBe("United States");
  });

  it("formats a rest-of-world address correctly", () => {
    const { addressLine, country } = formatDeliveryAddress({
      address: "10 Downing Street",
      city: "London",
      country: "GB",
    });
    expect(addressLine).toBe("10 Downing Street, London");
    expect(country).toBe("United Kingdom");
  });

  it("formats a Ghana (GH) address using region, street, and neighborhood", () => {
    const { addressLine, country } = formatDeliveryAddress({
      country: "GH",
      region: "GA", // Greater Accra
      street: "Liberation Road",
      neighborhood: "east_legon",
      houseNumber: "5B",
    });
    expect(addressLine).toContain("Liberation Road");
    expect(addressLine).toContain("East Legon");
    expect(addressLine).toContain("Greater Accra");
    expect(country).toBe("Ghana");
  });

  it("omits house number gracefully when not provided for GH", () => {
    const { addressLine } = formatDeliveryAddress({
      country: "GH",
      region: "GA",
      street: "Liberation Road",
      neighborhood: "osu",
    });
    expect(addressLine).not.toMatch(/undefined/);
    expect(addressLine).toContain("Liberation Road");
  });
});
