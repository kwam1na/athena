import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import {
  advanceRegisterCatalogRevision,
  readRegisterCatalogRevision,
} from "./registerCatalogRevision";

type RevisionRow = {
  _id: string;
  storeId: string;
  revision: number;
  updatedAt: number;
};

function createRevisionCtx(seed: RevisionRow[] = []) {
  const rows = new Map(seed.map((row) => [row.storeId, row]));
  const inserts: RevisionRow[] = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      query() {
        return {
          withIndex(
            _index: string,
            applyIndex: (builder: {
              eq: (field: string, value: unknown) => unknown;
            }) => unknown,
          ) {
            let storeId: string | undefined;
            const builder = {
              eq(_field: string, value: unknown) {
                storeId = String(value);
                return builder;
              },
            };
            applyIndex(builder);
            return {
              async unique() {
                return storeId ? (rows.get(storeId) ?? null) : null;
              },
            };
          },
        };
      },
      async insert(_table: string, value: Omit<RevisionRow, "_id">) {
        const row = { _id: `revision-${value.storeId}`, ...value };
        rows.set(value.storeId, row);
        inserts.push(row);
        return row._id;
      },
      async patch(
        _table: string,
        id: string,
        value: Record<string, unknown>,
      ) {
        const current = Array.from(rows.values()).find((row) => row._id === id);
        if (!current) throw new Error(`Missing revision row ${id}`);
        const next = { ...current, ...value } as RevisionRow;
        rows.set(next.storeId, next);
        patches.push({ id, value });
      },
    },
  };

  return { ctx, inserts, patches, rows };
}

describe("register catalog revision", () => {
  it("advances a store from the implicit zero baseline", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_234);
    const { ctx, inserts, patches } = createRevisionCtx();

    await expect(
      advanceRegisterCatalogRevision(ctx as never, {
        storeId: "store-a" as Id<"store">,
        didChange: true,
      }),
    ).resolves.toBe(1);
    expect(inserts).toEqual([
      expect.objectContaining({
        storeId: "store-a",
        revision: 1,
        updatedAt: 1_234,
      }),
    ]);
    await expect(
      advanceRegisterCatalogRevision(ctx as never, {
        storeId: "store-a" as Id<"store">,
        didChange: true,
      }),
    ).resolves.toBe(2);
    expect(patches).toEqual([
      expect.objectContaining({
        id: "revision-store-a",
        value: expect.objectContaining({ revision: 2, updatedAt: 1_234 }),
      }),
    ]);
    now.mockRestore();
  });

  it("does not create or advance a revision for a no-op", async () => {
    const { ctx, inserts, patches } = createRevisionCtx();

    await expect(
      advanceRegisterCatalogRevision(ctx as never, {
        storeId: "store-a" as Id<"store">,
        didChange: false,
      }),
    ).resolves.toBe(0);
    expect(inserts).toEqual([]);
    expect(patches).toEqual([]);
  });

  it("keeps independent monotonic sequences per store", async () => {
    const { ctx, rows } = createRevisionCtx([
      {
        _id: "revision-store-a",
        storeId: "store-a",
        revision: 4,
        updatedAt: 100,
      },
      {
        _id: "revision-store-b",
        storeId: "store-b",
        revision: 8,
        updatedAt: 100,
      },
    ]);

    await expect(
      advanceRegisterCatalogRevision(ctx as never, {
        storeId: "store-a" as Id<"store">,
        didChange: true,
      }),
    ).resolves.toBe(5);
    await expect(
      readRegisterCatalogRevision(
        ctx as never,
        "store-b" as Id<"store">,
      ),
    ).resolves.toBe(8);
    expect(rows.get("store-a")?.revision).toBe(5);
    expect(rows.get("store-b")?.revision).toBe(8);
  });
});
