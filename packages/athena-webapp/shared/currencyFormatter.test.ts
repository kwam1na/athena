import { describe, expect, it } from "vitest";

import { currencyFormatter } from "./currencyFormatter";

describe("currencyFormatter", () => {
  it("uses the Ghana cedi symbol for GHS", () => {
    expect(currencyFormatter("GHS").format(1250)).toBe("GH₵1,250");
  });

  it("keeps standard Intl formatting for other currencies", () => {
    expect(currencyFormatter("USD").format(1250)).toBe("$1,250");
  });
});
