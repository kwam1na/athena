import { describe, expect, it } from "vitest";

import {
  parsePromoDiscountInput,
  promoDiscountDisplayText,
  promoDiscountInputValue,
} from "./promoCodeMoney";

const formatter = new Intl.NumberFormat("en-GH", {
  currency: "GHS",
  style: "currency",
});

describe("promo code money helpers", () => {
  it("parses fixed discount display amounts as minor units", () => {
    expect(parsePromoDiscountInput("10.99", "amount")).toBe(1099);
  });

  it("keeps percentage discounts as raw percentages", () => {
    expect(parsePromoDiscountInput("15", "percentage")).toBe(15);
  });

  it("formats stored fixed discounts as display values for editing and preview", () => {
    expect(promoDiscountInputValue(1099, "amount")).toBe("10.99");
    expect(promoDiscountDisplayText(1099, "amount", formatter)).toBe(
      formatter.format(10.99)
    );
  });

  it("formats stored percentage discounts without money conversion", () => {
    expect(promoDiscountInputValue(15, "percentage")).toBe("15");
    expect(promoDiscountDisplayText(15, "percentage", formatter)).toBe("15%");
  });
});
