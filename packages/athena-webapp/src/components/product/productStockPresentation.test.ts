import { describe, expect, it } from "vitest";

import { productStockTextClass } from "./productStockPresentation";

describe("productStockTextClass", () => {
  it.each([
    { quantityAvailable: 0, expected: "text-danger" },
    { quantityAvailable: 2, expected: "text-warning" },
    { quantityAvailable: 3, expected: "text-success" },
  ])(
    "uses $expected when sellable stock is $quantityAvailable",
    ({ quantityAvailable, expected }) => {
      expect(productStockTextClass(quantityAvailable)).toBe(expected);
    },
  );
});
