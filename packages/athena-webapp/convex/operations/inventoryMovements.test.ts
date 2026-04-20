import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  buildInventoryMovement,
  summarizeInventoryMovements,
} from "./inventoryMovements";

describe("inventory movement helpers", () => {
  it("builds auditable inventory movements with timestamps", () => {
    const movement = buildInventoryMovement({
      storeId: "store_1" as Id<"store">,
      movementType: "sale",
      sourceType: "pos_transaction",
      sourceId: "pos_txn_1",
      quantityDelta: -2,
      productSkuId: "sku_1" as Id<"productSku">,
    });

    expect(movement).toMatchObject({
      storeId: "store_1",
      movementType: "sale",
      sourceType: "pos_transaction",
      quantityDelta: -2,
      productSkuId: "sku_1",
    });
    expect(movement.createdAt).toEqual(expect.any(Number));
  });

  it("summarizes net stock deltas across movements", () => {
    expect(
      summarizeInventoryMovements([
        { quantityDelta: 4 },
        { quantityDelta: -1 },
        { quantityDelta: -2 },
      ])
    ).toEqual({
      movementCount: 3,
      netDelta: 1,
    });
  });
});
