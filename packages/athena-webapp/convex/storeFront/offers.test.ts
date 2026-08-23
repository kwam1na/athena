import { describe, expect, it } from "vitest";

import {
  buildOfferProductEmailItem,
  formatOfferProductPrice,
  getDiscountedOfferProductPrice,
} from "./offers";

const formatter = new Intl.NumberFormat("en-GH", {
  currency: "GHS",
  style: "currency",
});

describe("offer product price formatting", () => {
  it("formats stored SKU prices as display currency for offer payloads", () => {
    expect(formatOfferProductPrice(formatter, 15_000)).toBe(
      formatter.format(150),
    );
  });

  it("keeps discounted offer prices in minor units until display formatting", () => {
    const productSku = {
      colorName: "Natural",
      images: ["https://example.com/image.jpg"],
      price: 15_000,
      productCategory: "Hair",
      productName: "Body Wave",
      sku: "BW-18",
    };
    const promoCode = {
      discountType: "percentage",
      discountValue: 10,
    };

    expect(getDiscountedOfferProductPrice(productSku.price, promoCode)).toBe(
      13_500,
    );
    expect(
      buildOfferProductEmailItem({
        formatter,
        productSku,
        productUrl: "https://example.com/product",
        promoCode,
      }),
    ).toMatchObject({
      discounted_price: formatter.format(135),
      original_price: formatter.format(150),
      product_url: "https://example.com/product",
    });
  });

  it("reads a fixed-amount promo discount as pesewas, not GHS", () => {
    const productSku = {
      colorName: "Natural",
      images: ["https://example.com/image.jpg"],
      price: 15_000,
      productCategory: "Hair",
      productName: "Body Wave",
      sku: "BW-18",
    };
    // GHS 25.00 off, stored as 2_500 pesewas by `promoCodeMoney`.
    const promoCode = {
      discountType: "amount",
      discountValue: 2_500,
    };

    expect(getDiscountedOfferProductPrice(productSku.price, promoCode)).toBe(
      12_500,
    );
    expect(
      buildOfferProductEmailItem({
        formatter,
        productSku,
        productUrl: "https://example.com/product",
        promoCode,
      }),
    ).toMatchObject({
      discounted_price: formatter.format(125),
      original_price: formatter.format(150),
    });
  });
});
