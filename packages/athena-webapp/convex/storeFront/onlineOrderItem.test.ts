// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

function wrapDefinition<T extends { handler: (...args: any[]) => any }>(
  definition: T
) {
  return Object.assign(
    (ctx: unknown, args: unknown) => definition.handler(ctx, args),
    definition
  );
}
function h(fn: any): (...args: any[]) => any {
  return fn.handler;
}


async function loadModule() {
  vi.resetModules();

  vi.doMock("../_generated/server", () => ({
    query: wrapDefinition,
    mutation: wrapDefinition,
  }));

  return import("./onlineOrderItem");
}

describe("onlineOrderItem", () => {
  it("returns an order item by id", async () => {
    const { get } = await loadModule();
    const db = {
      get: vi.fn().mockResolvedValue({ _id: "item_1" }),
    };

    const result = await h(get)({ db } as never, { id: "item_1" });

    expect(db.get).toHaveBeenCalledWith("item_1");
    expect(result).toEqual({ _id: "item_1" });
  });

  it("decrements sku inventory when item becomes ready", async () => {
    const { update } = await loadModule();

    const db = {
      patch: vi.fn().mockResolvedValue(undefined),
      get: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "item_1",
          productSkuId: "sku_1",
          quantity: 3,
        })
        .mockResolvedValueOnce({
          _id: "sku_1",
          inventoryCount: 10,
        }),
    };

    await h(update)({ db } as never, {
      id: "item_1",
      updates: { isReady: true, note: "packed" },
    });

    expect(db.patch).toHaveBeenNthCalledWith(1, "item_1", {
      isReady: true,
      note: "packed",
    });
    expect(db.patch).toHaveBeenNthCalledWith(2, "sku_1", {
      inventoryCount: 7,
    });
  });

  it("increments sku inventory when ready is reverted", async () => {
    const { update } = await loadModule();

    const db = {
      patch: vi.fn().mockResolvedValue(undefined),
      get: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "item_1",
          productSkuId: "sku_1",
          quantity: 2,
        })
        .mockResolvedValueOnce({
          _id: "sku_1",
          inventoryCount: 10,
        }),
    };

    await h(update)({ db } as never, {
      id: "item_1",
      updates: { isReady: false },
    });

    expect(db.patch).toHaveBeenNthCalledWith(2, "sku_1", {
      inventoryCount: 12,
    });
  });

  it("exits safely when the order item is missing", async () => {
    const { update } = await loadModule();

    const db = {
      patch: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
    };

    await expect(
      h(update)({ db } as never, {
        id: "item_1",
        updates: { isReady: true },
      })
    ).resolves.toBeUndefined();

    expect(db.patch).toHaveBeenCalledTimes(1);
  });

  it("exits safely when the sku is missing", async () => {
    const { update } = await loadModule();

    const db = {
      patch: vi.fn().mockResolvedValue(undefined),
      get: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "item_1",
          productSkuId: "sku_1",
          quantity: 3,
        })
        .mockResolvedValueOnce(null),
    };

    await expect(
      h(update)({ db } as never, {
        id: "item_1",
        updates: { isReady: true },
      })
    ).resolves.toBeUndefined();

    expect(db.patch).toHaveBeenCalledTimes(1);
  });

  it("only patches the order item when isReady is not provided", async () => {
    const { update } = await loadModule();

    const db = {
      patch: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
    };

    await h(update)({ db } as never, {
      id: "item_1",
      updates: { note: "no inventory change" },
    });

    expect(db.patch).toHaveBeenCalledTimes(1);
    expect(db.patch).toHaveBeenCalledWith("item_1", {
      note: "no inventory change",
    });
    expect(db.get).not.toHaveBeenCalled();
  });

  it("exits safely when unready path cannot find an order item", async () => {
    const { update } = await loadModule();

    const db = {
      patch: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
    };

    await expect(
      h(update)({ db } as never, {
        id: "item_1",
        updates: { isReady: false },
      })
    ).resolves.toBeUndefined();

    expect(db.patch).toHaveBeenCalledTimes(1);
  });

  it("exits safely when unready path cannot find a sku", async () => {
    const { update } = await loadModule();

    const db = {
      patch: vi.fn().mockResolvedValue(undefined),
      get: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "item_1",
          productSkuId: "sku_1",
          quantity: 2,
        })
        .mockResolvedValueOnce(null),
    };

    await expect(
      h(update)({ db } as never, {
        id: "item_1",
        updates: { isReady: false },
      })
    ).resolves.toBeUndefined();

    expect(db.patch).toHaveBeenCalledTimes(1);
  });
});
