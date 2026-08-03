import { describe, expect, it, vi } from "vitest";

import {
  backfillStoreCurrencyCaseWithCtx,
  verifyStoreCurrencyCaseWithCtx,
} from "./backfillStoreCurrencyCase";

type Store = {
  _id: string;
  currency?: string;
};

function createCtx(initialStores: Store[]) {
  const stores = structuredClone(initialStores);
  const patch = vi.fn(
    async (_table: string, id: string, value: Record<string, unknown>) => {
      const store = stores.find((candidate) => candidate._id === id);
      if (!store) throw new Error(`Missing store ${id}`);
      Object.assign(store, value);
    },
  );
  const query = vi.fn(() => ({
    paginate: vi.fn(
      async ({
        cursor,
        numItems,
      }: {
        cursor: string | null;
        numItems: number;
      }) => {
        const start = cursor ? Number(cursor) : 0;
        const end = Math.min(start + numItems, stores.length);
        return {
          continueCursor: String(end),
          isDone: end >= stores.length,
          page: stores.slice(start, end),
        };
      },
    ),
  }));

  const runAfter = vi.fn(async (..._args: unknown[]) => "job" as never);
  return {
    ctx: { db: { patch, query }, scheduler: { runAfter } } as any,
    patch,
    runAfter,
    stores,
  };
}

async function finishBackfill(
  ctx: ReturnType<typeof createCtx>["ctx"],
  dryRun: boolean,
) {
  let cursor: string | null = null;
  let changedCount = 0;
  let mismatchedCount = 0;

  while (true) {
    const result = await backfillStoreCurrencyCaseWithCtx(ctx, {
      cursor,
      dryRun,
      limit: 1,
    });
    changedCount += result.changedCount;
    mismatchedCount += result.mismatchedCount;
    if (result.isDone) return { changedCount, mismatchedCount };
    cursor = result.continueCursor;
  }
}

async function finishVerification(ctx: ReturnType<typeof createCtx>["ctx"]) {
  let cursor: string | null = null;
  let mismatchedCount = 0;

  while (true) {
    const result = await verifyStoreCurrencyCaseWithCtx(ctx, {
      cursor,
      limit: 1,
    });
    mismatchedCount += result.mismatchedCount;
    if (result.isDone) return { mismatchedCount };
    cursor = result.continueCursor;
  }
}

describe("store currency case backfill", () => {
  it("dry-runs, then normalizes only the rows that need it", async () => {
    // "Wigclub" is the production row that blanked the weekly surface.
    const harness = createCtx([
      { _id: "store-wigclub", currency: "ghs" },
      { _id: "store-clean", currency: "GHS" },
      { _id: "store-padded", currency: " usd " },
      { _id: "store-empty", currency: "" },
    ]);

    await expect(finishVerification(harness.ctx)).resolves.toEqual({
      mismatchedCount: 3,
    });

    await expect(finishBackfill(harness.ctx, true)).resolves.toEqual({
      changedCount: 0,
      mismatchedCount: 3,
    });
    expect(harness.patch).not.toHaveBeenCalled();
    expect(harness.stores[0]!.currency).toBe("ghs");

    await expect(finishBackfill(harness.ctx, false)).resolves.toEqual({
      changedCount: 3,
      mismatchedCount: 3,
    });
    expect(harness.stores).toEqual([
      { _id: "store-wigclub", currency: "GHS" },
      { _id: "store-clean", currency: "GHS" },
      { _id: "store-padded", currency: "USD" },
      // An empty currency takes the helper's GHS default.
      { _id: "store-empty", currency: "GHS" },
    ]);
    // The already-canonical row is never written.
    expect(harness.patch).toHaveBeenCalledTimes(3);

    await expect(finishVerification(harness.ctx)).resolves.toEqual({
      mismatchedCount: 0,
    });
  });

  it("is a no-op on re-run", async () => {
    const harness = createCtx([
      { _id: "store-1", currency: "ghs" },
      { _id: "store-2", currency: "GHS" },
    ]);

    await finishBackfill(harness.ctx, false);
    expect(harness.patch).toHaveBeenCalledTimes(1);
    harness.patch.mockClear();

    await expect(finishBackfill(harness.ctx, false)).resolves.toEqual({
      changedCount: 0,
      mismatchedCount: 0,
    });
    expect(harness.patch).not.toHaveBeenCalled();
  });

  it("drives itself to completion when autoContinue is set", async () => {
    const harness = createCtx([
      { _id: "store-1", currency: "ghs" },
      { _id: "store-2", currency: "usd" },
      { _id: "store-3", currency: "GHS" },
    ]);

    const first = await backfillStoreCurrencyCaseWithCtx(harness.ctx, {
      autoContinue: true,
      dryRun: false,
      limit: 2,
    });

    expect(first.isDone).toBe(false);
    expect(harness.runAfter).toHaveBeenCalledTimes(1);
    const [, , scheduledArgs] = harness.runAfter.mock.calls[0]!;
    expect(scheduledArgs).toMatchObject({
      autoContinue: true,
      changedSoFar: 2,
      cursor: first.continueCursor,
      dryRun: false,
      limit: 2,
      mismatchedSoFar: 2,
      processedSoFar: 2,
    });

    const second = await backfillStoreCurrencyCaseWithCtx(
      harness.ctx,
      scheduledArgs as never,
    );
    expect(second.isDone).toBe(true);
    expect(second.totals).toEqual({
      changedCount: 2,
      mismatchedCount: 2,
      processedCount: 3,
    });
    // A finished chain must not schedule another link.
    expect(harness.runAfter).toHaveBeenCalledTimes(1);
  });

  it("never self-schedules unless autoContinue is requested", async () => {
    const harness = createCtx([
      { _id: "store-1", currency: "ghs" },
      { _id: "store-2", currency: "ghs" },
    ]);

    const result = await backfillStoreCurrencyCaseWithCtx(harness.ctx, {
      dryRun: false,
      limit: 1,
    });

    expect(result.isDone).toBe(false);
    expect(harness.runAfter).not.toHaveBeenCalled();
  });

  it("defaults to a dry run when dryRun is omitted", async () => {
    const harness = createCtx([{ _id: "store-1", currency: "ghs" }]);

    const result = await backfillStoreCurrencyCaseWithCtx(harness.ctx, {});

    expect(result.dryRun).toBe(true);
    expect(result.mismatchedCount).toBe(1);
    expect(result.changedCount).toBe(0);
    expect(harness.patch).not.toHaveBeenCalled();
  });

  it("verification writes nothing", async () => {
    const harness = createCtx([
      { _id: "store-1", currency: "ghs" },
      { _id: "store-2", currency: "GHS" },
    ]);

    await expect(finishVerification(harness.ctx)).resolves.toEqual({
      mismatchedCount: 1,
    });
    expect(harness.patch).not.toHaveBeenCalled();
    expect(harness.runAfter).not.toHaveBeenCalled();
    expect(harness.stores[0]!.currency).toBe("ghs");
  });
});
