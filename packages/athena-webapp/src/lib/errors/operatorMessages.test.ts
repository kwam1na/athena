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

  it.each([
    [
      "Open the cash drawer before starting a sale.",
      "Drawer closed. Open the drawer before starting a sale.",
    ],
    [
      "Open the cash drawer before resuming this sale.",
      "Drawer closed. Open the drawer before resuming this sale.",
    ],
    [
      "Open the cash drawer before recovering this sale.",
      "Drawer closed. Open the drawer before continuing this sale.",
    ],
    [
      "Open the cash drawer before modifying this sale.",
      "Drawer closed. Open the drawer before updating this sale.",
    ],
    [
      "Open the cash drawer before completing this sale.",
      "Drawer closed. Open the drawer before completing this sale.",
    ],
    [
      "This sale is already assigned to a different cash drawer.",
      "Sale assigned to a different drawer. Open that drawer before continuing.",
    ],
    [
      "A session is active for this cashier on a different terminal",
      "Cashier already has an active session on another terminal",
    ],
  ])("normalizes POS drawer command copy: %s", (backendMessage, operatorCopy) => {
    expect(toOperatorMessage(backendMessage)).toBe(operatorCopy);
  });

  it("normalizes backend phrasing despite case and whitespace drift", () => {
    expect(
      toOperatorMessage("  open the cash drawer before completing this sale  "),
    ).toBe("Drawer closed. Open the drawer before completing this sale.");
  });
});
