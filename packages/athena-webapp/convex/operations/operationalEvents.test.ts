import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { listProductOperationalTimelineWithCtx } from "./operationalEvents";

type TableName = "operationalEvent" | "product" | "productSku";
type Row = Record<string, unknown> & { _id: string };

function createCtx(seed: Partial<Record<TableName, Row[]>>) {
  const tables: Record<TableName, Map<string, Row>> = {
    operationalEvent: new Map(),
    product: new Map(),
    productSku: new Map(),
  };

  for (const [table, rows] of Object.entries(seed) as Array<
    [TableName, Row[]]
  >) {
    rows.forEach((row) => tables[table].set(row._id, row));
  }

  const ctx = {
    db: {
      async get(table: TableName, id: string) {
        return tables[table].get(id) ?? null;
      },
      query(table: TableName) {
        const filters: Array<[string, unknown]> = [];
        const rows = () =>
          Array.from(tables[table].values()).filter((row) =>
            filters.every(([field, value]) => row[field] === value),
          );

        const chain = {
          take: async (limit: number) => rows().slice(0, limit),
          withIndex(
            _index: string,
            applyIndex: (builder: {
              eq: (field: string, value: unknown) => typeof builder;
            }) => unknown,
          ) {
            const builder = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return builder;
              },
            };
            applyIndex(builder);
            return chain;
          },
        };

        return chain;
      },
    },
  } as unknown as QueryCtx;

  return ctx;
}

describe("operational events", () => {
  it("lists product and SKU operational events in newest-first order", async () => {
    const ctx = createCtx({
      product: [
        {
          _id: "product-1",
          storeId: "store-1",
        },
      ],
      productSku: [
        {
          _id: "sku-1",
          productId: "product-1",
          sku: "SKU-001",
        },
        {
          _id: "sku-2",
          productId: "product-1",
          sku: "SKU-002",
        },
      ],
      operationalEvent: [
        {
          _id: "event-product",
          createdAt: 100,
          eventType: "product_updated",
          message: "Product updated.",
          storeId: "store-1",
          subjectId: "product-1",
          subjectType: "product",
        },
        {
          _id: "event-sku",
          createdAt: 200,
          eventType: "pos_quick_add_product_created",
          message: "Kwamina Nuh quick added Vitamilk with quantity 100.",
          storeId: "store-1",
          subjectId: "sku-1",
          subjectLabel: "Vitamilk",
          subjectType: "product_sku",
        },
        {
          _id: "event-other-product",
          createdAt: 300,
          eventType: "pos_quick_add_product_created",
          message: "Other product.",
          storeId: "store-1",
          subjectId: "sku-other",
          subjectType: "product_sku",
        },
      ],
    });

    const result = await listProductOperationalTimelineWithCtx(ctx, {
      productId: "product-1" as Id<"product">,
      storeId: "store-1" as Id<"store">,
    });

    expect(result.map((event) => event.id)).toEqual([
      "event-sku",
      "event-product",
    ]);
    expect(result[0]).toMatchObject({
      message: "Kwamina Nuh quick added Vitamilk with quantity 100.",
      subject: {
        id: "sku-1",
        label: "Vitamilk",
        sku: "SKU-001",
        type: "product_sku",
      },
    });
  });

  it("returns no events when the product is outside the requested store", async () => {
    const ctx = createCtx({
      product: [
        {
          _id: "product-1",
          storeId: "store-2",
        },
      ],
    });

    await expect(
      listProductOperationalTimelineWithCtx(ctx, {
        productId: "product-1" as Id<"product">,
        storeId: "store-1" as Id<"store">,
      }),
    ).resolves.toEqual([]);
  });
});
