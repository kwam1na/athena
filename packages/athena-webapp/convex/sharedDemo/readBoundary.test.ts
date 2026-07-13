import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./actor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./actor")>();
  return {
    ...actual,
    requireSharedDemoStoreReadIfApplicable: vi.fn(),
  };
});

import { getAll as getProducts } from "../inventory/products";
import {
  getInventoryUnitSummary,
  listInventorySnapshot,
  listInventorySnapshotPage,
} from "../stockOps/adjustments";
import {
  get as getOrder,
  getOrderMetrics,
  newOrder,
} from "../storeFront/onlineOrder";
import { requireSharedDemoStoreReadIfApplicable } from "./actor";

const invoke = (fn: unknown, ctx: unknown, args: unknown) =>
  (fn as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })
    ._handler(ctx, args);

describe("shared demo read store boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [getProducts, { storeId: "other-store" }],
    [listInventorySnapshot, { storeId: "other-store" }],
    [getInventoryUnitSummary, { storeId: "other-store" }],
    [
      listInventorySnapshotPage,
      {
        paginationOpts: { cursor: null, numItems: 25 },
        storeId: "other-store",
      },
    ],
    [newOrder, { storeId: "other-store" }],
    [getOrderMetrics, { storeId: "other-store", timeRange: "day" }],
  ] as const)(
    "rejects a store-scoped read before its domain query runs",
    async (fn, args) => {
      const denial = new Error(
        "This action is unavailable in the shared demo.",
      );
      vi.mocked(requireSharedDemoStoreReadIfApplicable).mockRejectedValueOnce(
        denial,
      );
      const ctx = { db: { get: vi.fn(), query: vi.fn() } };

      await expect(invoke(fn, ctx, args)).rejects.toThrow(denial.message);
      expect(requireSharedDemoStoreReadIfApplicable).toHaveBeenCalledWith(
        ctx,
        "other-store",
      );
      expect(ctx.db.get).not.toHaveBeenCalled();
      expect(ctx.db.query).not.toHaveBeenCalled();
    },
  );

  it("authorizes an order's store before reading its child data", async () => {
    const denial = new Error(
      "This action is unavailable in the shared demo.",
    );
    vi.mocked(requireSharedDemoStoreReadIfApplicable).mockRejectedValueOnce(
      denial,
    );
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue({
          _id: "order-1",
          storeId: "other-store",
        }),
        query: vi.fn(),
      },
    };

    await expect(
      invoke(getOrder, ctx, { identifier: "order-1" }),
    ).rejects.toThrow(denial.message);
    expect(requireSharedDemoStoreReadIfApplicable).toHaveBeenCalledWith(
      ctx,
      "other-store",
    );
    expect(ctx.db.get).toHaveBeenCalledTimes(1);
    expect(ctx.db.query).not.toHaveBeenCalled();
  });
});
