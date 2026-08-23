import { describe, expect, it, vi } from "vitest";

import {
  backfillAmountsToPesewasWithCtx,
  classifyRow,
  specForTable,
  verifyAmountsToPesewasWithCtx,
} from "./backfillAmountsToPesewas";

type Row = Record<string, any> & { _id: string; _creationTime: number };

const CUTOFF = 1_000_000;

function createCtx(seed: Record<string, Row[]>) {
  const tables = new Map<string, Row[]>(
    Object.entries(seed).map(([name, rows]) => [
      name,
      rows.map((row) => ({ ...row })),
    ]),
  );
  const getRows = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };

  const paginate = vi.fn();
  const query = vi.fn((name: string) => ({
    paginate: async ({
      cursor,
      numItems,
    }: {
      cursor: string | null;
      numItems: number;
    }) => {
      paginate({ cursor, numItems, table: name });
      const rows = getRows(name);
      const start = cursor ? Number(cursor) : 0;
      const end = Math.min(start + numItems, rows.length);
      return {
        continueCursor: String(end),
        isDone: end >= rows.length,
        // Snapshot copies, faithful to Convex: a later `patch` does not mutate
        // objects a page already handed out.
        page: rows.slice(start, end).map((row) => ({ ...row })),
      };
    },
  }));

  const patch = vi.fn(
    async (name: string, id: string, value: Record<string, unknown>) => {
      const row = getRows(name).find((candidate) => candidate._id === id);
      if (!row) throw new Error(`Missing ${name}:${id}`);
      Object.assign(row, value);
    },
  );

  const scheduled: Array<Record<string, unknown>> = [];
  const runAfter = vi.fn(
    async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
      scheduled.push(args);
      return "job" as never;
    },
  );

  return {
    ctx: { db: { patch, query }, scheduler: { runAfter } } as any,
    patch,
    paginate,
    rowsIn: getRows,
    runAfter,
    scheduled,
  };
}

/** Drive an autoContinue chain to completion, as the scheduler would. */
async function runChain(
  harness: ReturnType<typeof createCtx>,
  args: Record<string, unknown>,
) {
  let next: Record<string, unknown> | undefined = args;
  let last: any;
  let batches = 0;
  while (next) {
    last = await backfillAmountsToPesewasWithCtx(harness.ctx, next as any);
    batches += 1;
    next = harness.scheduled.shift();
    if (batches > 50) throw new Error("chain did not terminate");
  }
  return { batches, last };
}

function skuRows(count: number, price = 30): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    _id: `sku${index}`,
    _creationTime: 100,
    price,
  }));
}

describe("backfillAmountsToPesewas", () => {
  it("completes over multiple pages, one bounded read per batch", async () => {
    const harness = createCtx({ productSku: skuRows(57) });

    const { batches, last } = await runChain(harness, {
      autoContinue: true,
      cutoffTimestamp: CUTOFF,
      dryRun: false,
      limit: 10,
      table: "productSku",
    });

    expect(batches).toBe(6); // ceil(57/10)
    // Every read was a bounded page; nothing collected the table.
    expect(harness.paginate).toHaveBeenCalledTimes(6);
    for (const call of harness.paginate.mock.calls) {
      expect(call[0].numItems).toBe(10);
    }

    expect(last.isDone).toBe(true);
    expect(last.totals.convertedCount).toBe(57);
    expect(last.totals.processedCount).toBe(57);
    expect(
      harness.rowsIn("productSku").every((row) => row.price === 3_000),
    ).toBe(true);
  });

  it("caps the page size so a caller cannot reintroduce a full-table read", async () => {
    const harness = createCtx({ productSku: skuRows(5) });

    await backfillAmountsToPesewasWithCtx(harness.ctx, {
      cutoffTimestamp: CUTOFF,
      limit: 100_000,
      table: "productSku",
    } as any);

    expect(harness.paginate.mock.calls[0][0].numItems).toBe(100);
  });

  it("defaults to a dry run: reports the work and writes nothing", async () => {
    const harness = createCtx({
      checkoutSession: [
        { _id: "s1", _creationTime: 100, amount: 10, deliveryFee: 5 },
      ],
    });

    const result = await backfillAmountsToPesewasWithCtx(harness.ctx, {
      cutoffTimestamp: CUTOFF,
      table: "checkoutSession",
    } as any);

    expect(result.dryRun).toBe(true);
    expect(result.eligibleCount).toBe(1);
    expect(result.convertedCount).toBe(0);
    expect(harness.patch).not.toHaveBeenCalled();
    expect(harness.rowsIn("checkoutSession")[0]).toMatchObject({
      amount: 10,
      deliveryFee: 5,
    });
  });

  it("skips an already-migrated row, so re-running never double-converts", async () => {
    const harness = createCtx({
      checkoutSession: [
        { _id: "s1", _creationTime: 100, amount: 10, deliveryFee: 5 },
      ],
    });
    const args = {
      cutoffTimestamp: CUTOFF,
      dryRun: false,
      table: "checkoutSession",
    };

    const first = await backfillAmountsToPesewasWithCtx(
      harness.ctx,
      args as any,
    );
    expect(first.convertedCount).toBe(1);
    const afterFirst = harness.rowsIn("checkoutSession")[0];
    expect(afterFirst).toMatchObject({ amount: 1_000, deliveryFee: 500 });
    // The marker landed in the same patch as the money.
    expect(harness.patch.mock.calls[0][2]).toMatchObject({
      amount: 1_000,
      deliveryFee: 500,
      pesewasMigratedAt: expect.any(Number),
    });

    const second = await backfillAmountsToPesewasWithCtx(
      harness.ctx,
      args as any,
    );
    expect(second.convertedCount).toBe(0);
    expect(second.eligibleCount).toBe(0);
    expect(second.skippedCount).toBe(1);
    expect(harness.rowsIn("checkoutSession")[0]).toMatchObject({
      amount: 1_000,
      deliveryFee: 500,
    });
  });

  it("reports ambiguous rows with a reason instead of converting them", async () => {
    const harness = createCtx({
      productSku: [
        // The case the legacy < 10_000 heuristic silently guessed at.
        { _id: "big", _creationTime: 100, price: 15_000 },
        { _id: "negative", _creationTime: 100, price: -5 },
        { _id: "subPesewa", _creationTime: 100, price: 10.005 },
        { _id: "fine", _creationTime: 100, price: 12.99 },
      ],
    });

    const result = await backfillAmountsToPesewasWithCtx(harness.ctx, {
      cutoffTimestamp: CUTOFF,
      dryRun: false,
      table: "productSku",
    } as any);

    expect(result.ambiguousCount).toBe(3);
    expect(result.ambiguousIds.sort()).toEqual([
      "big",
      "negative",
      "subPesewa",
    ]);
    expect(result.ambiguousReasons).toMatchObject({
      magnitudeIndistinguishable: 1,
      negativeValue: 1,
      subPesewaPrecision: 1,
    });

    // Only the unambiguous row was written.
    expect(result.convertedCount).toBe(1);
    const byId = Object.fromEntries(
      harness.rowsIn("productSku").map((row) => [row._id, row.price]),
    );
    expect(byId.big).toBe(15_000);
    expect(byId.negative).toBe(-5);
    expect(byId.subPesewa).toBe(10.005);
    expect(byId.fine).toBe(1_299);

    // Ambiguous rows are never stamped, so they stay visible to the verifier
    // run after run rather than being quietly retired.
    expect(
      harness
        .rowsIn("productSku")
        .filter((row) => row.pesewasMigratedAt !== undefined)
        .map((row) => row._id),
    ).toEqual(["fine"]);
  });

  it("leaves post-cutoff rows alone", async () => {
    const harness = createCtx({
      bagItem: [
        { _id: "legacy", _creationTime: CUTOFF - 1, price: 20 },
        { _id: "modern", _creationTime: CUTOFF, price: 20 },
      ],
    });

    const result = await backfillAmountsToPesewasWithCtx(harness.ctx, {
      cutoffTimestamp: CUTOFF,
      dryRun: false,
      table: "bagItem",
    } as any);

    expect(result.convertedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    const byId = Object.fromEntries(
      harness.rowsIn("bagItem").map((row) => [row._id, row.price]),
    );
    expect(byId.legacy).toBe(2_000);
    expect(byId.modern).toBe(20);
  });

  it("converts nested store delivery fees and stamps the store row", async () => {
    const harness = createCtx({
      store: [
        {
          _id: "store1",
          _creationTime: 100,
          config: {
            commerce: {
              deliveryFees: { withinAccra: 30, otherRegions: 50 },
              waiveDeliveryFees: { minimumOrderAmount: 400 },
            },
          },
        },
      ],
    });
    const args = { cutoffTimestamp: CUTOFF, dryRun: false, table: "store" };

    await backfillAmountsToPesewasWithCtx(harness.ctx, args as any);
    const store = harness.rowsIn("store")[0];
    expect(store.config.commerce.deliveryFees).toMatchObject({
      otherRegions: 5_000,
      withinAccra: 3_000,
    });
    expect(store.config.commerce.waiveDeliveryFees.minimumOrderAmount).toBe(
      40_000,
    );
    expect(store.pesewasMigratedAt).toBeTypeOf("number");

    // The legacy migrateStoreConfigs had no cutoff and no marker, so a second
    // run multiplied by 100 again. This one is a no-op.
    const second = await backfillAmountsToPesewasWithCtx(
      harness.ctx,
      args as any,
    );
    expect(second.convertedCount).toBe(0);
    expect(
      harness.rowsIn("store")[0].config.commerce.deliveryFees.withinAccra,
    ).toBe(3_000);
  });

  it("verification reports zero eligible rows once the backfill drains", async () => {
    const harness = createCtx({
      productSku: [
        ...skuRows(12),
        { _id: "ambiguous", _creationTime: 100, price: 20_000 },
      ],
    });
    const verifyArgs = {
      cursor: null as string | null,
      cutoffTimestamp: CUTOFF,
      limit: 100,
      table: "productSku",
    };

    const before = await verifyAmountsToPesewasWithCtx(
      harness.ctx,
      verifyArgs as any,
    );
    expect(before.eligibleCount).toBe(12);
    expect(before.ambiguousCount).toBe(1);
    expect(before.migratedCount).toBe(0);

    await runChain(harness, {
      autoContinue: true,
      cutoffTimestamp: CUTOFF,
      dryRun: false,
      limit: 5,
      table: "productSku",
    });

    const after = await verifyAmountsToPesewasWithCtx(
      harness.ctx,
      verifyArgs as any,
    );
    expect(after.eligibleCount).toBe(0);
    expect(after.migratedCount).toBe(12);
    // The ambiguous row is still reported — it is a human's call, not the
    // migration's, and the verifier must not let it disappear.
    expect(after.ambiguousCount).toBe(1);
    expect(after.ambiguousReasons.magnitudeIndistinguishable).toBe(1);
  });

  it("verification writes nothing", async () => {
    const harness = createCtx({ productSku: skuRows(3) });
    await verifyAmountsToPesewasWithCtx(harness.ctx, {
      cutoffTimestamp: CUTOFF,
      table: "productSku",
    } as any);
    expect(harness.patch).not.toHaveBeenCalled();
    expect(harness.runAfter).not.toHaveBeenCalled();
  });

  it("rejects an unknown table rather than silently doing nothing", async () => {
    const harness = createCtx({});
    await expect(
      backfillAmountsToPesewasWithCtx(harness.ctx, {
        cutoffTimestamp: CUTOFF,
        table: "notAMoneyTable",
      } as any),
    ).rejects.toThrow(/Unknown amount money table/);
  });

  describe("classifyRow", () => {
    const spec = specForTable("productSku");
    const base = { ambiguousAtOrAbove: 10_000, cutoffTimestamp: CUTOFF };

    it("checks the marker before anything else", () => {
      // A converted row's values would look ambiguous on their own; the marker
      // short-circuits before they are ever inspected.
      expect(
        classifyRow(
          spec,
          {
            _id: "x",
            _creationTime: 100,
            pesewasMigratedAt: 5,
            price: 3_000_000,
          },
          base,
        ),
      ).toEqual({ status: "alreadyMigrated" });
    });

    it("treats a row with no money values as nothing to do", () => {
      expect(
        classifyRow(spec, { _id: "x", _creationTime: 100 }, base),
      ).toEqual({ reason: "noMoneyValues", status: "notEligible" });
    });

    it("honours a caller-supplied ambiguity bound", () => {
      const row = { _id: "x", _creationTime: 100, price: 500 };
      expect(classifyRow(spec, row, base)).toEqual({ status: "eligible" });
      expect(
        classifyRow(spec, row, { ...base, ambiguousAtOrAbove: 100 }),
      ).toEqual({ reason: "magnitudeIndistinguishable", status: "ambiguous" });
    });

    it("flags a row when any one of several money fields is ambiguous", () => {
      expect(
        classifyRow(
          spec,
          { _id: "x", _creationTime: 100, price: 30, unitCost: 50_000 },
          base,
        ),
      ).toEqual({ reason: "magnitudeIndistinguishable", status: "ambiguous" });
    });
  });
});
