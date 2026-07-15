import { describe, expect, it } from "vitest";

import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  calculateSelectedProductPromoDiscount,
  getById,
  getPromoCodeItems,
  getPromoCodeItemsLightweight,
  remove,
  update,
} from "./promoCode";

describe("promo code public return contracts", () => {
  it("preserves query and command results behind demo restrictions", () => {
    assertConformsToExportedReturns(getById, null);
    assertConformsToExportedReturns(getPromoCodeItems, []);
    assertConformsToExportedReturns(getPromoCodeItemsLightweight, []);
    assertConformsToExportedReturns(remove, { success: true });
    assertConformsToExportedReturns(update, { success: true });
  });
});

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
