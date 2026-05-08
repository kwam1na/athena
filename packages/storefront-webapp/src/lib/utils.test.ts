import { describe, expect, it } from "vitest";

import {
  capitalizeFirstLetter,
  capitalizeWords,
  currencyFormatter,
  slugToWords,
} from "./utils";
import { formatStoredAmount, toDisplayAmount } from "./currency";

describe("utils", () => {
  it("capitalizes the first letter of a string", () => {
    expect(capitalizeFirstLetter("athena")).toBe("Athena");
    expect(capitalizeFirstLetter("")).toBe("");
  });

  it("capitalizes every word in a string", () => {
    expect(capitalizeWords("natural black body wave")).toBe(
      "Natural Black Body Wave"
    );
  });

  it("converts slugs back to words", () => {
    expect(slugToWords("same-day-delivery")).toBe("same day delivery");
  });

  it("formats currency values without decimals", () => {
    expect(currencyFormatter("USD").format(1250)).toBe("$1,250");
  });

  it("uses the Athena Ghana cedi symbol for GHS", () => {
    expect(currencyFormatter("GHS").format(1250)).toBe("GH₵1,250");
  });

  it("preserves fractional cedi values after minor-unit conversion", () => {
    expect(currencyFormatter("GHS").format(toDisplayAmount(2999))).toBe(
      "GH₵29.99"
    );
  });

  it("formats stored minor-unit order amounts for display", () => {
    const formatter = currencyFormatter("GHS");

    expect(formatStoredAmount(formatter, 10000)).toBe("GH₵100");
    expect(formatStoredAmount(formatter, 500)).toBe("GH₵5");
    expect(formatStoredAmount(formatter, 2999)).toBe("GH₵29.99");
    expect(formatStoredAmount(formatter, 2999 * 2)).toBe("GH₵59.98");
  });
});
