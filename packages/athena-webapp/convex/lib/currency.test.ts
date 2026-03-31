import { describe, expect, it } from "vitest";
import { toPesewas, toDisplayAmount } from "./currency";

describe("toPesewas", () => {
  it("converts whole numbers", () => {
    expect(toPesewas(150)).toBe(15000);
  });

  it("converts decimals", () => {
    expect(toPesewas(29.99)).toBe(2999);
  });

  it("handles zero", () => {
    expect(toPesewas(0)).toBe(0);
  });

  it("rounds floating point edge cases", () => {
    expect(toPesewas(19.99)).toBe(1999);
  });
});

describe("toDisplayAmount", () => {
  it("converts pesewas to GHS", () => {
    expect(toDisplayAmount(15000)).toBe(150);
  });

  it("handles zero", () => {
    expect(toDisplayAmount(0)).toBe(0);
  });
});
