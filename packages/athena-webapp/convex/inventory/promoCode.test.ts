import { describe, expect, it } from "vitest";

import { calculateSelectedProductPromoDiscount } from "./promoCode";

describe("selected-product promo discounts", () => {
  it("applies percentage discounts to item price times quantity", () => {
    expect(
      calculateSelectedProductPromoDiscount(
        { price: 5_000, quantity: 3 },
        { discountType: "percentage", discountValue: 10 },
      ),
    ).toBe(1_500);
  });

  it("keeps fixed discounts as stored minor-unit amounts", () => {
    expect(
      calculateSelectedProductPromoDiscount(
        { price: 5_000, quantity: 3 },
        { discountType: "amount", discountValue: 750 },
      ),
    ).toBe(750);
  });
});
