import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import { markCatalogSummaryNeedsRefresh } from "./catalogSummary";

function createCatalogSummaryCtx(args?: {
  queryThrows?: boolean;
  rows?: Array<Record<string, unknown> & { _id: string }>;
}) {
  const rows = new Map((args?.rows ?? []).map((row) => [row._id, row]));
  let insertCount = rows.size;
  let patchCount = 0;

  const ctx = {
    db: {
      query(tableName: string) {
        if (args?.queryThrows) {
          throw new Error("test query failure");
        }

        return {
          withIndex(
            _indexName: string,
            applyIndex: (query: {
              eq: (field: string, value: unknown) => unknown;
            }) => unknown,
          ) {
            let storeId: unknown;
            applyIndex({
              eq(field, value) {
                if (field === "storeId") storeId = value;
                return undefined;
              },
            });

            return {
              first: async () =>
                Array.from(rows.values()).find(
                  (row) =>
                    tableName === "catalogSummary" && row.storeId === storeId,
                ) ?? null,
            };
          },
        };
      },
      async insert(tableName: string, value: Record<string, unknown>) {
        insertCount += 1;
        const id = `${tableName}-${insertCount}`;
        rows.set(id, { _id: id, ...value });
        return id;
      },
      async patch(tableName: string, id: string, patch: Record<string, unknown>) {
        patchCount += 1;
        const existing = rows.get(id);
        if (!existing) throw new Error(`Missing ${tableName} row`);
        rows.set(id, { ...existing, ...patch });
      },
    },
  };

  return { ctx, getPatchCount: () => patchCount, rows };
}

describe("catalog summary dirty marker", () => {
  it("inserts a stale summary row when no row exists", async () => {
    const { ctx, rows } = createCatalogSummaryCtx();

    const id = await markCatalogSummaryNeedsRefresh(ctx as never, "store-1" as Id<"store">);

    expect(id).toBe("catalogSummary-1");
    expect(rows.get("catalogSummary-1")).toMatchObject({
      categoryCount: 0,
      missingInfoProductCount: 0,
      needsRefresh: true,
      outOfStockProductCount: 0,
      productCount: 0,
      storeId: "store-1",
    });
  });

  it("patches a fresh row without recomputing the catalog", async () => {
    const { ctx, getPatchCount, rows } = createCatalogSummaryCtx({
      rows: [
        {
          _id: "summary-1",
          categoryCount: 2,
          missingInfoProductCount: 1,
          needsRefresh: false,
          outOfStockProductCount: 1,
          productCount: 3,
          storeId: "store-1",
          updatedAt: 10,
        },
      ],
    });

    await markCatalogSummaryNeedsRefresh(ctx as never, "store-1" as Id<"store">);

    expect(rows.get("summary-1")).toMatchObject({ needsRefresh: true });
    expect(getPatchCount()).toBe(1);
  });

  it("leaves an already-stale row stale without another write", async () => {
    const { ctx, getPatchCount, rows } = createCatalogSummaryCtx({
      rows: [
        {
          _id: "summary-1",
          categoryCount: 2,
          missingInfoProductCount: 1,
          needsRefresh: true,
          outOfStockProductCount: 1,
          productCount: 3,
          storeId: "store-1",
          updatedAt: 10,
        },
      ],
    });

    await markCatalogSummaryNeedsRefresh(ctx as never, "store-1" as Id<"store">);

    expect(rows.get("summary-1")).toMatchObject({ needsRefresh: true });
    expect(getPatchCount()).toBe(0);
  });

  it("does not throw when the marker row cannot be read", async () => {
    const { ctx } = createCatalogSummaryCtx({
      queryThrows: true,
    });

    await expect(
      markCatalogSummaryNeedsRefresh(ctx as never, "store-1" as Id<"store">),
    ).resolves.toBeUndefined();
  });
});
