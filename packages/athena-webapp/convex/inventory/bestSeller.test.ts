import { describe, expect, it, vi } from "vitest";

import type { QueryCtx } from "../_generated/server";
import { getAll } from "./bestSeller";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("best-seller product visibility", () => {
  it("filters archived product SKUs from public best-seller results", async () => {
    const bestSellers = [
      {
        _id: "bestSeller-live",
        productSkuId: "sku-live",
        storeId: "store123",
      },
      {
        _id: "bestSeller-archived",
        productSkuId: "sku-archived",
        storeId: "store123",
      },
    ];
    const skus = new Map([
      [
        "sku-live",
        {
          _id: "sku-live",
          isVisible: true,
          product: { availability: "live" },
        },
      ],
      [
        "sku-archived",
        {
          _id: "sku-archived",
          isVisible: true,
          product: { availability: "archived" },
        },
      ],
    ]);

    const ctx = {
      db: {
        query() {
          return {
            filter() {
              return {
                collect: async () => bestSellers,
              };
            },
          };
        },
      },
      runQuery: vi.fn(async (_ref, args: { id: string }) => skus.get(args.id)),
    } as unknown as QueryCtx;

    const results = await getHandler(getAll)(ctx, {
      storeId: "store123",
      isVisible: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0]._id).toBe("bestSeller-live");
    expect(results[0].productSku._id).toBe("sku-live");
  });
});
