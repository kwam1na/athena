/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import { api } from "../_generated/api";
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

// Cuts the module cycle `platform/operationAdmission` ->
// `sharedDemo/operationAdapter` -> `sharedDemo/restore` ->
// `sharedDemo/openingBaseline` -> `inventory/storeSchedule` ->
// `platform/operationAdmission`. Left intact, the composition root is observed
// half-initialized from this test's module graph.
vi.mock("../sharedDemo/restore", () => ({
  requireReadySharedDemoWriteWithCtx: vi.fn(),
}));

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

/**
 * `inventory/stores:create` now runs through the admission rail, so a caller
 * must present a real Athena identity: an auth `users` row, a matching
 * `athenaUser` row, and the `<authUserId>|<session>` identity subject the auth
 * component reads.
 */
async function asAuthenticatedAthenaUser(
  t: ReturnType<typeof convexTest>,
  email: string,
) {
  const authUserId = await t.run((ctx) => ctx.db.insert("users", { email }));
  return { as: t.withIdentity({ subject: `${authUserId}|test-session` }) };
}

describe("store creation currency normalization", () => {
  async function createStoreWithCurrency(currency: string) {
    const t = convexTest(schema, modules);
    const owner = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", {
        email: "owner@test",
        normalizedEmail: "owner@test",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: userId,
        name: "org",
        slug: "org",
      });
      return { organizationId, userId };
    });
    const { as } = await asAuthenticatedAthenaUser(t, "owner@test");

    return await as.mutation(api.inventory.stores.create, {
      createdByUserId: owner.userId,
      currency,
      name: "Wigclub",
      organizationId: owner.organizationId,
      slug: "wigclub",
    });
  }

  // The creation form takes currency as free text. A lowercase code here is
  // what made Daily Close stamp report facts that the day fold read as a
  // second currency, which blanked every weekly total.
  it.each([
    ["lowercase", "ghs", "GHS"],
    ["padded", "  ghs  ", "GHS"],
    ["mixed case", "Usd", "USD"],
    ["empty", "", "GHS"],
    ["whitespace only", "   ", "GHS"],
  ])("normalizes a %s currency on write", async (_label, input, expected) => {
    const store = await createStoreWithCurrency(input);
    expect(store?.currency).toBe(expected);
  });

  it("leaves an already-canonical currency untouched", async () => {
    const store = await createStoreWithCurrency("USD");
    expect(store?.currency).toBe("USD");
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
