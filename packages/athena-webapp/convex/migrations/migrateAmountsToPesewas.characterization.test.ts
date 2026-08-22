import { describe, expect, it, vi } from "vitest";

import {
  migrateCheckoutSessions,
  migrateProductSkuPrices,
  migrateStoreConfigs,
} from "./migrateAmountsToPesewas";

/**
 * CHARACTERIZATION of the legacy amount→pesewas migrations, captured BEFORE the
 * V26-963 refactor. Every assertion here documents what the code actually did,
 * not what it should do. Several of these behaviours are the bugs the ticket
 * exists to remove — they are pinned so the refactor's intent is legible in the
 * diff rather than argued about.
 *
 * The legacy handlers are registered `internalMutation`s with no testable
 * `...WithCtx` seam, so we reach the raw closure through `_handler`, which the
 * Convex function wrapper keeps on the export.
 */
type Row = Record<string, any> & { _id: string; _creationTime: number };

function invoke(fn: unknown, ctx: unknown, args: unknown) {
  return (fn as { _handler: (c: unknown, a: unknown) => Promise<any> })._handler(
    ctx,
    args,
  );
}

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
  const collect = vi.fn(async function collectFor(this: { table: string }) {
    // Snapshot copies: Convex's `ctx.db.patch` does not mutate objects a prior
    // `collect()` returned.
    return getRows(this.table).map((row) => ({ ...row }));
  });

  const query = vi.fn((name: string) => ({
    table: name,
    collect: collect.bind({ table: name }),
    paginate,
  }));

  const patch = vi.fn(
    async (name: string, id: string, value: Record<string, unknown>) => {
      const row = getRows(name).find((candidate) => candidate._id === id);
      if (!row) throw new Error(`Missing ${name}:${id}`);
      Object.assign(row, value);
    },
  );

  return {
    ctx: { db: { query, patch } } as any,
    collect,
    paginate,
    patch,
    query,
    rowsIn: (name: string) => getRows(name),
  };
}

describe("legacy amount migrations (characterization)", () => {
  it("reads the whole table with .collect() and never paginates", async () => {
    const harness = createCtx({
      checkoutSession: Array.from({ length: 120 }, (_, index) => ({
        _id: `s${index}`,
        _creationTime: 100,
        amount: 10,
      })),
    });

    const result = await invoke(migrateCheckoutSessions, harness.ctx, {
      cutoffTimestamp: 1_000,
    });

    // The entire table is pulled into a single transaction — this is the
    // Convex transaction-limit exposure the ticket is about.
    expect(harness.collect).toHaveBeenCalledTimes(1);
    expect(harness.paginate).not.toHaveBeenCalled();
    expect(result).toEqual({ migrated: 120, skipped: 0, total: 120 });
    expect(harness.patch).toHaveBeenCalledTimes(120);
  });

  it("double-converts on a re-run because nothing marks a migrated row", async () => {
    const harness = createCtx({
      checkoutSession: [
        { _id: "s1", _creationTime: 100, amount: 10, deliveryFee: 5 },
      ],
    });
    const args = { cutoffTimestamp: 1_000 };

    await invoke(migrateCheckoutSessions, harness.ctx, args);
    expect(harness.rowsIn("checkoutSession")[0]).toMatchObject({
      amount: 1_000,
      deliveryFee: 500,
    });

    // Re-running multiplies by 100 a second time. The only guard is
    // `_creationTime`, which never changes, so the row stays eligible forever.
    await invoke(migrateCheckoutSessions, harness.ctx, args);
    expect(harness.rowsIn("checkoutSession")[0]).toMatchObject({
      amount: 100_000,
      deliveryFee: 50_000,
    });
  });

  it("decides productSku conversion with a < 10_000 magnitude heuristic", async () => {
    const harness = createCtx({
      productSku: [
        // GHS 50 legacy row. Indistinguishable from 5_000 pesewas (GHS 50)
        // already migrated — genuinely ambiguous, and silently dropped.
        { _id: "ambiguous", _creationTime: 100, price: 5_000 },
        // One pesewa under the threshold: skipped even though it is legacy.
        { _id: "justUnder", _creationTime: 100, price: 9_999 },
        // At the threshold: converted.
        { _id: "atThreshold", _creationTime: 100, price: 10_000 },
      ],
    });

    const result = await invoke(migrateProductSkuPrices, harness.ctx, {
      cutoffTimestamp: 1_000,
    });

    const byId = Object.fromEntries(
      harness.rowsIn("productSku").map((row) => [row._id, row.price]),
    );
    expect(byId.ambiguous).toBe(5_000); // untouched, and unreported
    expect(byId.justUnder).toBe(9_999); // untouched, and unreported
    expect(byId.atThreshold).toBe(1_000_000); // converted

    // Ambiguous rows are folded into the same `skipped` bucket as
    // post-cutoff rows, so the operator cannot tell them apart.
    expect(result).toEqual({ migrated: 1, skipped: 2, total: 3 });
  });

  it("migrates store configs with no cutoff and no marker at all", async () => {
    const harness = createCtx({
      store: [
        {
          _id: "store1",
          _creationTime: 100,
          config: {
            commerce: {
              deliveryFees: { withinAccra: 30, otherRegions: 50 },
            },
          },
        },
      ],
    });

    // Note: no `cutoffTimestamp` argument exists on this one.
    await invoke(migrateStoreConfigs, harness.ctx, {});
    expect(
      harness.rowsIn("store")[0].config.commerce.deliveryFees,
    ).toMatchObject({ withinAccra: 3_000, otherRegions: 5_000 });

    await invoke(migrateStoreConfigs, harness.ctx, {});
    expect(
      harness.rowsIn("store")[0].config.commerce.deliveryFees,
    ).toMatchObject({ withinAccra: 300_000, otherRegions: 500_000 });
  });

  it("offers no dry-run: calling it always writes", async () => {
    const harness = createCtx({
      checkoutSession: [{ _id: "s1", _creationTime: 100, amount: 10 }],
    });

    await invoke(migrateCheckoutSessions, harness.ctx, {
      cutoffTimestamp: 1_000,
      // There is no `dryRun` arg; an unknown key is simply ignored.
      dryRun: true,
    });

    expect(harness.patch).toHaveBeenCalledTimes(1);
    expect(harness.rowsIn("checkoutSession")[0].amount).toBe(1_000);
  });
});
