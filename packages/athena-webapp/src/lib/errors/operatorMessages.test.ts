import { describe, expect, it } from "vitest";

import { toOperatorMessage } from "./operatorMessages";

describe("toOperatorMessage", () => {
  it("normalizes known backend phrasing into operator copy", () => {
    expect(
      toOperatorMessage("Open the cash drawer before modifying this sale."),
    ).toBe("Drawer closed. Open the drawer before updating this sale.");
  });

  it("passes through messages that already fit the tone guide", () => {
    expect(
      toOperatorMessage("Barcode not found. Scan again or search by name."),
    ).toBe("Barcode not found. Scan again or search by name.");
  });
});
