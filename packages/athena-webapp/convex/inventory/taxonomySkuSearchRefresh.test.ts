import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  create as createCategory,
  remove as removeCategory,
  update as updateCategory,
} from "./categories";
import { remove as removeColor, update as updateColor } from "./colors";
import {
  remove as removeSubcategory,
  update as updateSubcategory,
} from "./subcategories";

const mocks = vi.hoisted(() => ({
  refreshProductSkuSearchForCategory: vi.fn(),
  refreshProductSkuSearchForColor: vi.fn(),
  refreshProductSkuSearchForSubcategory: vi.fn(),
  markCatalogSummaryNeedsRefresh: vi.fn(),
}));

vi.mock("./skuSearch", () => ({
  refreshProductSkuSearchForCategory: mocks.refreshProductSkuSearchForCategory,
  refreshProductSkuSearchForColor: mocks.refreshProductSkuSearchForColor,
  refreshProductSkuSearchForSubcategory:
    mocks.refreshProductSkuSearchForSubcategory,
}));

vi.mock("./catalogSummary", () => ({
  markCatalogSummaryNeedsRefresh: mocks.markCatalogSummaryNeedsRefresh,
}));

type Row = Record<string, unknown> & { _id: string };
type TableName = "category" | "color" | "subcategory";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function createCtx(seed: Partial<Record<TableName, Row[]>>) {
  const tables: Record<TableName, Map<string, Row>> = {
    category: new Map((seed.category ?? []).map((row) => [row._id, row])),
    color: new Map((seed.color ?? []).map((row) => [row._id, row])),
    subcategory: new Map((seed.subcategory ?? []).map((row) => [row._id, row])),
  };

  const ctx = {
    db: {
      async get(tableOrId: TableName | string, maybeId?: string) {
        if (maybeId === undefined) {
          for (const rows of Object.values(tables)) {
            const row = rows.get(tableOrId);
            if (row) return row;
          }
          return null;
        }

        return tables[tableOrId as TableName].get(maybeId) ?? null;
      },
      async insert(table: TableName, value: Record<string, unknown>) {
        const id = `${table}-${tables[table].size + 1}`;
        tables[table].set(id, { _id: id, ...value });
        return id;
      },
      async patch(
        tableOrId: TableName | string,
        idOrPatch: string | Record<string, unknown>,
        maybePatch?: Record<string, unknown>,
      ) {
        const table = maybePatch
          ? (tableOrId as TableName)
          : findTableForId(String(tableOrId));
        const id = maybePatch ? String(idOrPatch) : String(tableOrId);
        const patch = maybePatch ?? (idOrPatch as Record<string, unknown>);
        const existing = tables[table].get(id);
        if (!existing) throw new Error(`Missing ${table}: ${id}`);
        tables[table].set(id, { ...existing, ...patch });
      },
      async delete(tableOrId: TableName | string, maybeId?: string) {
        if (maybeId === undefined) {
          tables[findTableForId(tableOrId)].delete(tableOrId);
          return;
        }

        tables[tableOrId as TableName].delete(maybeId);
      },
    },
  } as unknown as MutationCtx;

  function findTableForId(id: string): TableName {
    for (const [table, rows] of Object.entries(tables)) {
      if (rows.has(id)) return table as TableName;
    }
    throw new Error(`No table contains ${id}`);
  }

  return { ctx, tables };
}

describe("taxonomy SKU search refresh", () => {
  beforeEach(() => {
    mocks.refreshProductSkuSearchForCategory.mockReset();
    mocks.refreshProductSkuSearchForColor.mockReset();
    mocks.refreshProductSkuSearchForSubcategory.mockReset();
    mocks.markCatalogSummaryNeedsRefresh.mockReset();
  });

  it("marks the catalog summary stale after category creation", async () => {
    const { ctx } = createCtx({});

    await getHandler(createCategory)(ctx, {
      name: "Beverages",
      showOnStorefront: true,
      slug: "beverages",
      storeId: "store-1" as Id<"store">,
    });

    expect(mocks.markCatalogSummaryNeedsRefresh).toHaveBeenCalledWith(
      ctx,
      "store-1",
    );
  });

  it("refreshes SKU search projections after category metadata changes", async () => {
    const { ctx } = createCtx({
      category: [{ _id: "category-1", name: "Wigs", storeId: "store-1" }],
    });

    await getHandler(updateCategory)(ctx, {
      id: "category-1" as Id<"category">,
      name: "Bundles",
    });

    expect(mocks.refreshProductSkuSearchForCategory).toHaveBeenCalledWith(
      ctx,
      "category-1",
    );
    expect(mocks.markCatalogSummaryNeedsRefresh).toHaveBeenCalledWith(
      ctx,
      "store-1",
    );
  });

  it("refreshes SKU search projections after subcategory metadata changes", async () => {
    const { ctx } = createCtx({
      subcategory: [
        {
          _id: "subcategory-1",
          categoryId: "category-1",
          name: "Closures",
          storeId: "store-1",
        },
      ],
    });

    await getHandler(updateSubcategory)(ctx, {
      id: "subcategory-1" as Id<"subcategory">,
      name: "Frontals",
    });

    expect(mocks.refreshProductSkuSearchForSubcategory).toHaveBeenCalledWith(
      ctx,
      "subcategory-1",
    );
  });

  it("refreshes SKU search projections after color metadata changes", async () => {
    const { ctx } = createCtx({
      color: [{ _id: "color-1", name: "Black", storeId: "store-1" }],
    });

    await getHandler(updateColor)(ctx, {
      id: "color-1" as Id<"color">,
      name: "Natural black",
    });

    expect(mocks.refreshProductSkuSearchForColor).toHaveBeenCalledWith(
      ctx,
      "color-1",
    );
  });

  it("refreshes SKU search projections after category deletion", async () => {
    const { ctx } = createCtx({
      category: [{ _id: "category-1", name: "Wigs", storeId: "store-1" }],
    });

    await getHandler(removeCategory)(ctx, {
      id: "category-1" as Id<"category">,
    });

    expect(mocks.refreshProductSkuSearchForCategory).toHaveBeenCalledWith(
      ctx,
      "category-1",
    );
    expect(mocks.markCatalogSummaryNeedsRefresh).toHaveBeenCalledWith(
      ctx,
      "store-1",
    );
  });

  it("refreshes SKU search projections after subcategory deletion", async () => {
    const { ctx } = createCtx({
      subcategory: [
        {
          _id: "subcategory-1",
          categoryId: "category-1",
          name: "Closures",
          storeId: "store-1",
        },
      ],
    });

    await getHandler(removeSubcategory)(ctx, {
      id: "subcategory-1" as Id<"subcategory">,
    });

    expect(mocks.refreshProductSkuSearchForSubcategory).toHaveBeenCalledWith(
      ctx,
      "subcategory-1",
    );
  });

  it("refreshes SKU search projections after color deletion", async () => {
    const { ctx } = createCtx({
      color: [{ _id: "color-1", name: "Black", storeId: "store-1" }],
    });

    await getHandler(removeColor)(ctx, {
      id: "color-1" as Id<"color">,
    });

    expect(mocks.refreshProductSkuSearchForColor).toHaveBeenCalledWith(
      ctx,
      "color-1",
    );
  });
});
