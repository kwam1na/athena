import { describe, expect, it } from "vitest";

import { formatStoredAmount, parseDisplayAmountInput } from "./displayAmounts";
import { validatePaymentAmount, validatePayments } from "./validation";

const formatter = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
});

describe("POS display amounts", () => {
  it("formats stored pesewas values in display units", () => {
    expect(formatStoredAmount(formatter, 15000)).toBe(formatter.format(150));
    expect(formatStoredAmount(formatter, 15000)).not.toBe(
      formatter.format(15000)
    );
  });

  it("parses display input back to stored pesewas", () => {
    expect(parseDisplayAmountInput("GH₵150.50")).toBe(15050);
    expect(parseDisplayAmountInput("0.75")).toBe(75);
    expect(parseDisplayAmountInput("")).toBeUndefined();
  });

  it("renders payment validation errors in display units", () => {
    const validation = validatePaymentAmount(15000, 10000, formatter, "card");

    expect(validation.isValid).toBe(false);
    expect(validation.errors[0]).toContain(formatter.format(150));
    expect(validation.errors[0]).toContain(formatter.format(100));
    expect(validation.errors[0]).not.toContain(formatter.format(15000));
  });

  it("renders total-paid validation errors in display units", () => {
    const validation = validatePayments([{ amount: 15000 }], 20000, formatter);

    expect(validation.isValid).toBe(false);
    expect(validation.errors[0]).toContain(formatter.format(200));
    expect(validation.errors[0]).toContain(formatter.format(150));
    expect(validation.errors[0]).not.toContain(formatter.format(20000));
  });
});
