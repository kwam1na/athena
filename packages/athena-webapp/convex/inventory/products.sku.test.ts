import { describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createSku, updateSku } from "./products";

type TableName = "product" | "productSku";
type Row = Record<string, unknown> & { _id: string };

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function createSkuMutationCtx(seed: Partial<Record<TableName, Row[]>>) {
  const tables: Record<TableName, Map<string, Row>> = {
    product: new Map((seed.product ?? []).map((row) => [row._id, row])),
    productSku: new Map((seed.productSku ?? []).map((row) => [row._id, row])),
  };
  const counters: Record<TableName, number> = {
    product: 0,
    productSku: seed.productSku?.length ?? 0,
  };

  function createIndexedQuery(
    table: TableName,
    filters: Array<[string, unknown]>,
  ) {
    const matches = Array.from(tables[table].values()).filter((row) =>
      filters.every(([field, value]) => row[field] === value),
    );

    return {
      first: async () => matches[0] ?? null,
      collect: async () => matches,
    };
  }

  const ctx = {
    db: {
      async get(table: TableName, id: string) {
        return tables[table].get(id) ?? null;
      },
      async insert(table: TableName, value: Record<string, unknown>) {
        counters[table] += 1;
        const id = `${table}00${counters[table]}`;
        tables[table].set(id, { _id: id, ...value });
        return id;
      },
      async patch(table: TableName, id: string, value: Record<string, unknown>) {
        const existing = tables[table].get(id);
        if (!existing) {
          throw new Error(`Missing ${table}: ${id}`);
        }

        tables[table].set(id, { ...existing, ...value });
      },
      query(table: TableName) {
        return {
          filter() {
            return createIndexedQuery(
              table,
              table === "product" ? [["_id", "product001"]] : [],
            );
          },
          withIndex(
            _index: string,
            applyIndex: (queryBuilder: {
              eq: (field: string, value: unknown) => unknown;
            }) => unknown,
          ) {
            const filters: Array<[string, unknown]> = [];
            const queryBuilder = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return queryBuilder;
              },
            };

            applyIndex(queryBuilder);
            return createIndexedQuery(table, filters);
          },
        };
      },
    },
  } as unknown as MutationCtx;

  return { ctx, tables };
}

describe("inventory SKU generation", () => {
  it("generates a standard SKU when createSku receives an empty SKU", async () => {
    const { ctx, tables } = createSkuMutationCtx({
      product: [
        {
          _id: "product001",
          storeId: "storezzzz",
        },
      ],
    });

    const result = await getHandler(createSku)(ctx, {
      attributes: {},
      images: [],
      inventoryCount: 1,
      price: 1000,
      productId: "product001" as Id<"product">,
      quantityAvailable: 1,
      sku: "   ",
      storeId: "storezzzz" as Id<"store">,
    });

    expect(result.sku).toMatch(/^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/);
    expect(result.sku).not.toBe("TEMP_SKU");
    expect(result.sku).not.toBe("   ");
    expect(Array.from(tables.productSku.values())[0].sku).toBe(result.sku);
  });

  it("regenerates a standard SKU when updateSku receives an empty SKU", async () => {
    const { ctx } = createSkuMutationCtx({
      productSku: [
        {
          _id: "productSku001",
          inventoryCount: 1,
          price: 1000,
          productId: "product001",
          quantityAvailable: 1,
          sku: "OLD-SKU",
          storeId: "storezzzz",
        },
      ],
    });

    const patchSpy = vi.spyOn(ctx.db, "patch");

    const result = await getHandler(updateSku)(ctx, {
      id: "productSku001" as Id<"productSku">,
      sku: "",
    });

    expect(result.sku).toMatch(/^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/);
    expect(result.sku).not.toBe("OLD-SKU");
    expect(patchSpy).toHaveBeenCalledWith(
      "productSku",
      "productSku001",
      expect.objectContaining({ sku: result.sku }),
    );
  });
});
