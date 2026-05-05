import { describe, expect, it, vi } from "vitest";

import { createInventoryHoldGateway } from "./inventoryHoldGateway";

function createCtx(quantityAvailable = 5) {
  const sku = {
    _id: "sku-1",
    quantityAvailable,
  };
  const patches: Array<Record<string, unknown>> = [];

  return {
    ctx: {
      db: {
        get: vi.fn(async (tableName: string, id: string) =>
          tableName === "productSku" && id === "sku-1" ? sku : null,
        ),
        patch: vi.fn(async (_tableName: string, _id: string, patch: Record<string, unknown>) => {
          patches.push(patch);
          Object.assign(sku, patch);
        }),
      },
    },
    patches,
    sku,
  };
}

describe("createInventoryHoldGateway legacy quantity-patch compatibility", () => {
  it("subtracts availability for tuple acquire calls", async () => {
    const { ctx, patches } = createCtx(5);
    const gateway = createInventoryHoldGateway(ctx as never);

    await expect(gateway.acquireHold("sku-1" as never, 2)).resolves.toEqual({
      success: true,
    });

    expect(patches).toEqual([{ quantityAvailable: 3 }]);
  });

  it("restores availability for tuple release calls", async () => {
    const { ctx, patches } = createCtx(3);
    const gateway = createInventoryHoldGateway(ctx as never);

    await expect(gateway.releaseHold("sku-1" as never, 2)).resolves.toEqual({
      success: true,
    });

    expect(patches).toEqual([{ quantityAvailable: 5 }]);
  });

  it("adjusts tuple holds by patching only the quantity delta", async () => {
    const { ctx, patches } = createCtx(3);
    const gateway = createInventoryHoldGateway(ctx as never);

    await expect(
      gateway.adjustHold("sku-1" as never, 2, 5),
    ).resolves.toEqual({
      success: true,
    });
    await expect(
      gateway.adjustHold("sku-1" as never, 5, 4),
    ).resolves.toEqual({
      success: true,
    });
    await expect(
      gateway.adjustHold("sku-1" as never, 4, 4),
    ).resolves.toEqual({
      success: true,
    });

    expect(patches).toEqual([
      { quantityAvailable: 0 },
      { quantityAvailable: 1 },
    ]);
  });
});
