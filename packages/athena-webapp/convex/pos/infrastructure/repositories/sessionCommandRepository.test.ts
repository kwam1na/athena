import { describe, expect, it } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import {
  collectSessionItemsFromPages,
  findSessionItemBySkuInPages,
} from "./sessionCommandRepository";

describe("findSessionItemBySkuInPages", () => {
  it("keeps scanning later pages until it finds the matching sku", async () => {
    const skuId = "sku-target" as Id<"productSku">;

    const item = await findSessionItemBySkuInPages(
      async (cursor) => {
        if (cursor === null) {
          return {
            page: [
              { productSkuId: "sku-a" as Id<"productSku"> },
              { productSkuId: "sku-b" as Id<"productSku"> },
            ],
            isDone: false,
            continueCursor: "page-2",
          };
        }

        return {
          page: [{ productSkuId: skuId }],
          isDone: true,
          continueCursor: "done",
        };
      },
      skuId,
    );

    expect(item).toEqual({ productSkuId: skuId });
  });
});

describe("collectSessionItemsFromPages", () => {
  it("returns every item across paginated session results", async () => {
    const items = await collectSessionItemsFromPages(async (cursor) => {
      if (cursor === null) {
        return {
          page: [{ _id: "item-1" }, { _id: "item-2" }],
          isDone: false,
          continueCursor: "page-2",
        };
      }

      return {
        page: [{ _id: "item-3" }],
        isDone: true,
        continueCursor: "done",
      };
    });

    expect(items).toEqual([{ _id: "item-1" }, { _id: "item-2" }, { _id: "item-3" }]);
  });
});
