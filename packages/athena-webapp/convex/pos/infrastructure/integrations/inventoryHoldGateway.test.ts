import { describe, expect, it, vi } from "vitest";

import {
  acquireInventoryHold,
  adjustInventoryHold,
  releaseInventoryHold,
} from "../../../inventory/helpers/inventoryHolds";
import { createInventoryHoldGateway } from "./inventoryHoldGateway";

vi.mock("../../../inventory/helpers/inventoryHolds", () => ({
  acquireInventoryHold: vi.fn(async () => ({ success: true })),
  adjustInventoryHold: vi.fn(async () => ({ success: true })),
  releaseInventoryHold: vi.fn(async () => ({ success: true })),
}));

function createCtx() {
  return {
    db: {},
  };
}

function createLegacyPatchCtx() {
  return {
    db: {
      get: vi.fn(async () => ({
        _id: "sku-1",
        quantityAvailable: 5,
      })),
      patch: vi.fn(async () => undefined),
    },
  };
}

describe("createInventoryHoldGateway", () => {
  it("delegates acquire calls to the ledger helper with object-shaped args", async () => {
    const ctx = createCtx();
    const gateway = createInventoryHoldGateway(ctx as never);
    const args = {
      storeId: "store-1",
      sessionId: "session-1",
      skuId: "sku-1",
      quantity: 2,
      expiresAt: 1_000,
      now: 500,
    } as never;

    await expect(gateway.acquireHold(args)).resolves.toEqual({
      success: true,
    });

    expect(acquireInventoryHold).toHaveBeenCalledWith(ctx.db, args);
  });

  it("delegates adjust calls to the ledger helper with object-shaped args", async () => {
    const ctx = createCtx();
    const gateway = createInventoryHoldGateway(ctx as never);
    const args = {
      storeId: "store-1",
      sessionId: "session-1",
      skuId: "sku-1",
      oldQuantity: 2,
      newQuantity: 5,
      expiresAt: 1_000,
      now: 500,
    } as never;

    await expect(gateway.adjustHold(args)).resolves.toEqual({
      success: true,
    });

    expect(adjustInventoryHold).toHaveBeenCalledWith(ctx.db, args);
  });

  it("delegates release calls to the ledger helper with object-shaped args", async () => {
    const ctx = createCtx();
    const gateway = createInventoryHoldGateway(ctx as never);
    const args = {
      sessionId: "session-1",
      skuId: "sku-1",
      quantity: 2,
      now: 500,
    } as never;

    await expect(gateway.releaseHold(args)).resolves.toEqual({
      success: true,
    });

    expect(releaseInventoryHold).toHaveBeenCalledWith(ctx.db, args);
  });

  it("rejects tuple-shaped acquire calls instead of patching SKU availability", async () => {
    const ctx = createLegacyPatchCtx();
    const gateway = createInventoryHoldGateway(ctx as never);

    expect(() =>
      (gateway.acquireHold as never as (skuId: string, quantity: number) => unknown)(
        "sku-1",
        2,
      ),
    ).toThrow("object-shaped inventory hold arguments");

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});
