import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatStoredAmount,
  formatStoredCurrencyAmount,
  parseDisplayAmountInput,
} from "./displayAmounts";
import { validatePaymentAmount, validatePayments } from "./validation";

const formatter = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POS display amounts", () => {
  it("formats stored pesewas values in display units", () => {
    expect(formatStoredAmount(formatter, 15000)).toBe(formatter.format(150));
    expect(formatStoredAmount(formatter, 15000)).not.toBe(
      formatter.format(15000)
    );
  });

  it("reveals minor units only when operational cash values need them", () => {
    expect(
      formatStoredCurrencyAmount("GHS", 1897598, { revealMinorUnits: true }),
    ).toBe("GH₵18,975.98");
    expect(
      formatStoredCurrencyAmount("GHS", 1897600, { revealMinorUnits: true }),
    ).toBe("GH₵18,976");
    expect(formatStoredCurrencyAmount("GHS", 2)).toBe("GH₵0");
    expect(
      formatStoredCurrencyAmount("GHS", 2, { revealMinorUnits: true }),
    ).toBe("GH₵0.02");
  });

  it("parses display input back to stored pesewas", () => {
    expect(parseDisplayAmountInput("GH₵150.50")).toBe(15050);
    expect(parseDisplayAmountInput("0.75")).toBe(75);
    expect(parseDisplayAmountInput("")).toBeUndefined();
  });

  it("parses whole, decimal, and formatted display values as pesewas", () => {
    expect(parseDisplayAmountInput("12")).toBe(1200);
    expect(parseDisplayAmountInput("12.50")).toBe(1250);
    expect(parseDisplayAmountInput("GHS 1,234.56")).toBe(123456);
  });

  it("rejects empty, incomplete, negative, and non-numeric values", () => {
    expect(parseDisplayAmountInput("")).toBeUndefined();
    expect(parseDisplayAmountInput(".")).toBeUndefined();
    expect(parseDisplayAmountInput("-12")).toBeUndefined();
    expect(parseDisplayAmountInput("not an amount")).toBeUndefined();
  });

  it("renders payment validation errors in display units", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const validation = validatePaymentAmount(15000, 10000, formatter, "card");

    expect(validation.isValid).toBe(false);
    expect(validation.errors[0]).toContain(formatter.format(150));
    expect(validation.errors[0]).toContain(formatter.format(100));
    expect(validation.errors[0]).not.toContain(formatter.format(15000));
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining("[POS] Payment amount validation failed"),
    );
  });

  it("renders total-paid validation errors in display units", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const validation = validatePayments([{ amount: 15000 }], 20000, formatter);

    expect(validation.isValid).toBe(false);
    expect(validation.errors[0]).toContain(formatter.format(200));
    expect(validation.errors[0]).toContain(formatter.format(150));
    expect(validation.errors[0]).not.toContain(formatter.format(20000));
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining("[POS] Payments validation failed"),
    );
  });
});
