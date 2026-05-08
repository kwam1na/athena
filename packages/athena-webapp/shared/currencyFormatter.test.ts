import { describe, expect, it } from "vitest";

import { currencyDisplaySymbol, currencyFormatter } from "./currencyFormatter";

describe("currencyFormatter", () => {
  it("uses the Ghana cedi symbol for GHS", () => {
    expect(currencyFormatter("GHS").format(1250)).toBe("GH₵1,250");
  });

  it("preserves fractional cedi values while keeping whole cedis compact", () => {
    expect(currencyFormatter("GHS").format(100)).toBe("GH₵100");
    expect(currencyFormatter("GHS").format(100.02)).toBe("GH₵100.02");
    expect(currencyFormatter("USD").format(100.02)).toBe("$100.02");
  });

  it("keeps standard Intl formatting for other currencies", () => {
    expect(currencyFormatter("USD").format(1250)).toBe("$1,250");
  });
});

describe("currencyDisplaySymbol", () => {
  it("uses the Ghana cedi symbol for GHS", () => {
    expect(currencyDisplaySymbol("GHS")).toBe("GH₵");
  });

  it("keeps standard Intl currency symbols for other currencies", () => {
    expect(currencyDisplaySymbol("USD")).toBe("$");
  });
});
