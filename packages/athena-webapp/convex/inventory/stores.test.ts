/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import { ok } from "../../shared/commandResult";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  calculateTax,
  patchConfigV2Command,
  removeStoreWithCtx,
} from "./stores";
import { seedWeeklyRowsForDeletionTest } from "./storesTestSupport";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./inventory/"),
    loader,
  ]),
);

async function seedStore(ctx: MutationCtx, slug: string) {
  const userId = await ctx.db.insert("athenaUser", { email: `${slug}@test` });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: userId,
    name: slug,
    slug,
  });
  const storeId = await ctx.db.insert("store", {
    createdByUserId: userId,
    currency: "GHS",
    name: slug,
    organizationId,
    slug,
  });
  return { organizationId, storeId, userId };
}

async function weeklyRowCounts(ctx: QueryCtx, storeId: Id<"store">) {
  const [current, accepted, dirty] = await Promise.all([
    ctx.db
      .query("reportWeekCurrent")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .take(10),
    ctx.db
      .query("reportWeekAccepted")
      .withIndex("by_storeId_cycleStartDate", (q) => q.eq("storeId", storeId))
      .take(10),
    ctx.db
      .query("reportDirtyWeek")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .take(10),
  ]);
  return [current.length, accepted.length, dirty.length];
}

describe("admitted store public return contracts", () => {
  it("preserves configuration and tax results behind demo restrictions", () => {
    assertConformsToExportedReturns(patchConfigV2Command, ok(null));
    assertConformsToExportedReturns(calculateTax, {
      taxAmount: 0,
      totalWithTax: 2_500,
      taxRate: 0,
      taxName: "Tax",
    });
  });
});

describe("store deletion weekly retention", () => {
  it("deletes every weekly row for the removed store and preserves another store", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const removed = await seedStore(ctx, "removed-store");
      const retained = await seedStore(ctx, "retained-store");
      await seedWeeklyRowsForDeletionTest(
        ctx,
        removed.storeId,
        removed.organizationId,
      );
      await seedWeeklyRowsForDeletionTest(
        ctx,
        retained.storeId,
        retained.organizationId,
      );
      return { removed, retained };
    });

    const completed = await t.run(async (ctx) =>
      removeStoreWithCtx(ctx, seeded.removed.storeId),
    );
    expect(completed).toBe(true);

    await t.run(async (ctx) => {
      expect(await ctx.db.get("store", seeded.removed.storeId)).toBeNull();
      expect(await weeklyRowCounts(ctx, seeded.removed.storeId)).toEqual([
        0, 0, 0,
      ]);
      expect(await weeklyRowCounts(ctx, seeded.retained.storeId)).toEqual([
        1, 1, 1,
      ]);
    });
  });

  it("deletes accepted history beyond one cleanup batch", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const removed = await seedStore(ctx, "large-weekly-history");
      const retained = await seedStore(ctx, "other-large-weekly-history");
      await seedWeeklyRowsForDeletionTest(
        ctx,
        removed.storeId,
        removed.organizationId,
        401,
      );
      await seedWeeklyRowsForDeletionTest(
        ctx,
        retained.storeId,
        retained.organizationId,
      );
      return { removed, retained };
    });

    await t.run(async (ctx) => {
      const accepted = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", seeded.removed.storeId),
        )
        .take(402);
      expect(accepted).toHaveLength(401);
    });

    vi.useFakeTimers();
    try {
      const completed = await t.run(async (ctx) =>
        removeStoreWithCtx(ctx, seeded.removed.storeId),
      );
      expect(completed).toBe(false);

      await t.run(async (ctx) => {
        expect(await ctx.db.get("store", seeded.removed.storeId)).not.toBeNull();
        const remaining = await ctx.db
          .query("reportWeekAccepted")
          .withIndex("by_storeId_cycleStartDate", (q) =>
            q.eq("storeId", seeded.removed.storeId),
          )
          .take(402);
        expect(remaining).toHaveLength(301);
        expect(await weeklyRowCounts(ctx, seeded.retained.storeId)).toEqual([
          1, 1, 1,
        ]);
      });

      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }

    await t.run(async (ctx) => {
      expect(await ctx.db.get("store", seeded.removed.storeId)).toBeNull();
      expect(await weeklyRowCounts(ctx, seeded.removed.storeId)).toEqual([
        0, 0, 0,
      ]);
      expect(await weeklyRowCounts(ctx, seeded.retained.storeId)).toEqual([
        1, 1, 1,
      ]);
    });
  });
});
