import { describe, expect, it } from "vitest";

import { currentInventoryMetricRows } from "./inventory";

describe("current inventory projection metrics", () => {
  it("publishes known value and explicit unknown quantity separately", () => {
    expect(
      currentInventoryMetricRows({
        knownCostPoolMinor: 12_000,
        onHandQuantity: 10,
        sellableQuantity: 8,
        uncostedQuantity: 4,
      }),
    ).toEqual([
      { metric: "on_hand_units", unknownQuantity: 0, value: 10 },
      { metric: "sellable_units", unknownQuantity: 0, value: 8 },
      { metric: "inventory_value", unknownQuantity: 4, value: 12_000 },
    ]);
  });
});
