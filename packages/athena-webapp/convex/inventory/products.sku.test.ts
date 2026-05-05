import { describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { archive, createSku, getAll, updateSku } from "./products";

const mocks = vi.hoisted(() => ({
  requireStoreFullAdminAccess: vi.fn(),
}));

vi.mock("../stockOps/access", () => ({
  requireStoreFullAdminAccess: mocks.requireStoreFullAdminAccess,
}));

type TableName = "category" | "product" | "productSku" | "subcategory";
type Row = Record<string, unknown> & { _id: string };

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function createSkuMutationCtx(seed: Partial<Record<TableName, Row[]>>) {
  const tables: Record<TableName, Map<string, Row>> = {
    category: new Map((seed.category ?? []).map((row) => [row._id, row])),
    product: new Map((seed.product ?? []).map((row) => [row._id, row])),
    productSku: new Map((seed.productSku ?? []).map((row) => [row._id, row])),
    subcategory: new Map(
      (seed.subcategory ?? []).map((row) => [row._id, row]),
    ),
  };
  const counters: Record<TableName, number> = {
    category: 0,
    product: 0,
    productSku: seed.productSku?.length ?? 0,
    subcategory: 0,
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
      async delete(table: TableName, id: string) {
        tables[table].delete(id);
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
    scheduler: {
      runAfter: vi.fn(),
    },
  } as unknown as MutationCtx;

  return { ctx, tables };
}

function createProductsQueryCtx(seed: Partial<Record<TableName, Row[]>>) {
  const { ctx, tables } = createSkuMutationCtx(seed);
  const queryCtx = ctx as unknown as QueryCtx;

  queryCtx.db.query = ((table: TableName) => ({
    filter(applyFilter?: (queryBuilder: unknown) => (row: Row) => boolean) {
      const predicate = applyFilter
        ? applyFilter({
            field: (field: string) => field,
            eq: (field: string, value: unknown) => (row: Row) =>
              row[field] === value,
            and:
              (...predicates: Array<(row: Row) => boolean>) =>
              (row: Row) =>
                predicates.every((predicate) => predicate(row)),
            or:
              (...predicates: Array<(row: Row) => boolean>) =>
              (row: Row) =>
                predicates.some((predicate) => predicate(row)),
          })
        : () => true;

      const matches = Array.from(tables[table].values()).filter(predicate);
      return {
        collect: async () => matches,
        first: async () => matches[0] ?? null,
      };
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
      const matches = Array.from(tables[table].values()).filter((row) =>
        filters.every(([field, value]) => row[field] === value),
      );
      return {
        collect: async () => matches,
        first: async () => matches[0] ?? null,
      };
    },
  })) as unknown as QueryCtx["db"]["query"];

  return { ctx: queryCtx, tables };
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

describe("product archiving", () => {
  it("archives a product without deleting the product record", async () => {
    mocks.requireStoreFullAdminAccess.mockResolvedValue({});

    const { ctx, tables } = createSkuMutationCtx({
      product: [
        {
          _id: "product001",
          availability: "live",
          storeId: "storezzzz",
        },
      ],
    });
    const deleteSpy = vi.spyOn(ctx.db, "delete");

    const result = await getHandler(archive)(ctx, {
      id: "product001" as Id<"product">,
      storeId: "storezzzz" as Id<"store">,
    });

    expect(mocks.requireStoreFullAdminAccess).toHaveBeenCalledWith(
      ctx,
      "storezzzz",
    );
    expect(result).toMatchObject({
      _id: "product001",
      availability: "archived",
    });
    expect(tables.product.get("product001")).toMatchObject({
      availability: "archived",
    });
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

describe("product catalog visibility", () => {
  it("excludes archived products by default and returns only archived products when requested", async () => {
    const seed = {
      product: [
        {
          _id: "product-live",
          availability: "live",
          categoryId: "category-1",
          isVisible: true,
          name: "Live Product",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
        {
          _id: "product-archived",
          availability: "archived",
          categoryId: "category-1",
          isVisible: true,
          name: "Archived Product",
          storeId: "storezzzz",
          subcategoryId: "subcategory-1",
        },
      ],
      productSku: [
        {
          _id: "sku-live",
          images: ["live.jpg"],
          inventoryCount: 1,
          price: 1000,
          productId: "product-live",
          quantityAvailable: 1,
          storeId: "storezzzz",
        },
        {
          _id: "sku-archived",
          images: ["archived.jpg"],
          inventoryCount: 1,
          price: 1000,
          productId: "product-archived",
          quantityAvailable: 1,
          storeId: "storezzzz",
        },
      ],
    };

    const activeCtx = createProductsQueryCtx(seed).ctx;
    const defaultProducts = await getHandler(getAll)(activeCtx, {
      storeId: "storezzzz" as Id<"store">,
    });

    expect(defaultProducts.map((product: Row) => product._id)).toEqual([
      "product-live",
    ]);

    const archivedCtx = createProductsQueryCtx(seed).ctx;
    const archivedProducts = await getHandler(getAll)(archivedCtx, {
      storeId: "storezzzz" as Id<"store">,
      availability: "archived",
    });

    expect(archivedProducts.map((product: Row) => product._id)).toEqual([
      "product-archived",
    ]);
  });
});
