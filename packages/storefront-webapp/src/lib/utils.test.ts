import { describe, expect, it } from "vitest";

import {
  capitalizeFirstLetter,
  capitalizeWords,
  currencyFormatter,
  slugToWords,
} from "./utils";

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
});
