import { describe, expect, it } from "vitest";

import { toDisplayAmount } from "./currency";
import {
  getDiscountValue,
  getOrderAmount,
  getProductDiscountValue,
} from "./orderMath";

/**
 * Unit contract pinned here: every monetary number crossing `orderMath` is in
 * pesewas (minor units). That includes `items[].price`, the fixed-amount promo
 * `discountValue`/`value`, and every number these helpers return. Percentage
 * discounts are the one intentional exception — they stay raw (`10` means 10%).
 *
 * Conversion to GHS happens only at a display boundary via `toDisplayAmount`,
 * never inside this module. The assertions below fail loudly if anyone
 * reintroduces a GHS-scaled fixed discount or an in-module `* 100` / `/ 100`.
 */

// GHS 150.00 sticker price on a single SKU.
const PRODUCT_PRICE_PESEWAS = 15_000;
// GHS 25.00 fixed promo discount, as `promoCodeMoney` persists it.
const FIXED_DISCOUNT_PESEWAS = 2_500;

describe("getProductDiscountValue unit contract", () => {
  it("treats a fixed-amount discount value as pesewas, not GHS", () => {
    const discount = {
      discountType: "amount" as const,
      discountValue: FIXED_DISCOUNT_PESEWAS,
    };

    // Pesewas in, pesewas out: GHS 25 off a GHS 150 SKU.
    expect(getProductDiscountValue(PRODUCT_PRICE_PESEWAS, discount)).toBe(2_500);
    // Display boundary sees GHS 25.00, not GHS 0.25 and not GHS 2,500.
    expect(
      toDisplayAmount(getProductDiscountValue(PRODUCT_PRICE_PESEWAS, discount)),
    ).toBe(25);
    // The discounted price stays in pesewas for downstream math.
    expect(
      PRODUCT_PRICE_PESEWAS -
        getProductDiscountValue(PRODUCT_PRICE_PESEWAS, discount),
    ).toBe(12_500);
  });

  it("caps a fixed-amount discount at the pesewas product price", () => {
    const discount = {
      discountType: "amount" as const,
      discountValue: FIXED_DISCOUNT_PESEWAS,
    };

    // GHS 10.00 SKU, GHS 25.00 discount: capped, never negative.
    expect(getProductDiscountValue(1_000, discount)).toBe(1_000);
    expect(toDisplayAmount(getProductDiscountValue(1_000, discount))).toBe(10);
  });

  it("keeps percentage discount values raw and returns pesewas", () => {
    expect(
      getProductDiscountValue(PRODUCT_PRICE_PESEWAS, {
        discountType: "percentage",
        discountValue: 10,
      }),
    ).toBe(1_500);
    expect(
      toDisplayAmount(
        getProductDiscountValue(PRODUCT_PRICE_PESEWAS, {
          discountType: "percentage",
          discountValue: 10,
        }),
      ),
    ).toBe(15);
  });

  it("reads the `type`/`value` alias the same way as `discountType`/`discountValue`", () => {
    expect(
      getProductDiscountValue(PRODUCT_PRICE_PESEWAS, {
        type: "amount",
        value: FIXED_DISCOUNT_PESEWAS,
      }),
    ).toBe(2_500);
    expect(
      getProductDiscountValue(PRODUCT_PRICE_PESEWAS, {
        type: "percentage",
        value: 10,
      }),
    ).toBe(1_500);
  });

  it("returns 0 when there is no discount or no usable type/value", () => {
    expect(getProductDiscountValue(PRODUCT_PRICE_PESEWAS)).toBe(0);
    expect(getProductDiscountValue(PRODUCT_PRICE_PESEWAS, null)).toBe(0);
    expect(
      getProductDiscountValue(PRODUCT_PRICE_PESEWAS, {
        discountType: "amount",
      }),
    ).toBe(0);
  });
});

describe("getDiscountValue unit contract", () => {
  const items = [
    { productSkuId: "sku_a", quantity: 2, price: 15_000 },
    { productSkuId: "sku_b", quantity: 1, price: 5_000 },
  ];

  it("returns a fixed entire-order discount in pesewas, unscaled", () => {
    expect(
      getDiscountValue(items, {
        discountType: "amount",
        discountValue: FIXED_DISCOUNT_PESEWAS,
        span: "entire-order",
      }),
    ).toBe(2_500);
  });

  it("applies a percentage entire-order discount to the pesewas subtotal", () => {
    // Subtotal is 35_000 pesewas (GHS 350); 10% is 3_500 pesewas (GHS 35).
    expect(
      getDiscountValue(items, {
        discountType: "percentage",
        discountValue: 10,
        span: "entire-order",
      }),
    ).toBe(3_500);
  });

  it("caps a fixed selected-products discount at the eligible pesewas subtotal", () => {
    expect(
      getDiscountValue(items, {
        discountType: "amount",
        discountValue: 1_000_000,
        span: "selected-products",
        productSkus: ["sku_b"],
      }),
    ).toBe(5_000);
  });

  it("passes a backend-precalculated totalDiscount through as pesewas", () => {
    expect(getDiscountValue(items, { totalDiscount: 4_242 })).toBe(4_242);
  });
});

describe("getOrderAmount unit contract", () => {
  it("keeps subtotal, discount and delivery fee on the same pesewas scale", () => {
    const items = [{ productSkuId: "sku_a", quantity: 1, price: 15_000 }];

    expect(
      getOrderAmount({
        items,
        discount: {
          discountType: "amount",
          discountValue: FIXED_DISCOUNT_PESEWAS,
          span: "entire-order",
        },
        deliveryFee: 3_000,
        subtotal: 15_000,
      }),
    ).toBe(15_500);
  });
});
