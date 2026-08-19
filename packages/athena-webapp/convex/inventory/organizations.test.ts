/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { removeOrganizationWithCtx } from "./organizations";
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

async function weeklyRowCounts(ctx: MutationCtx, storeId: Id<"store">) {
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

async function seedOrganization(
  ctx: MutationCtx,
  slug: string,
  storeCount: number,
  acceptedCount = 1,
) {
  const userId = await ctx.db.insert("athenaUser", { email: `${slug}@test` });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: userId,
    name: slug,
    slug,
  });
  const storeIds = [];
  for (let index = 0; index < storeCount; index += 1) {
    const storeId = await ctx.db.insert("store", {
      createdByUserId: userId,
      currency: "GHS",
      name: `${slug}-${index}`,
      organizationId,
      slug: `${slug}-${index}`,
    });
    await seedWeeklyRowsForDeletionTest(
      ctx,
      storeId,
      organizationId,
      acceptedCount,
    );
    storeIds.push(storeId);
  }
  return { organizationId, storeIds };
}

describe("organization deletion weekly retention", () => {
  it("deletes weekly rows for every organization store and preserves other stores", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => ({
      removed: await seedOrganization(ctx, "removed-org", 2),
      retained: await seedOrganization(ctx, "retained-org", 1),
    }));

    vi.useFakeTimers();
    try {
      expect(
        await t.run(async (ctx) =>
          removeOrganizationWithCtx(ctx, seeded.removed.organizationId),
        ),
      ).toBe(true);
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }

    await t.run(async (ctx) => {
      expect(
        await ctx.db.get("organization", seeded.removed.organizationId),
      ).toBeNull();
      for (const storeId of seeded.removed.storeIds) {
        expect(await weeklyRowCounts(ctx, storeId)).toEqual([0, 0, 0]);
      }
      expect(await weeklyRowCounts(ctx, seeded.retained.storeIds[0]!)).toEqual([
        1, 1, 1,
      ]);
    });
  });

  it("cleans large weekly history independently for every organization store", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => ({
      removed: await seedOrganization(ctx, "large-removed-org", 2, 401),
      retained: await seedOrganization(ctx, "large-retained-org", 1),
    }));

    await t.run(async (ctx) => {
      for (const storeId of seeded.removed.storeIds) {
        const accepted = await ctx.db
          .query("reportWeekAccepted")
          .withIndex("by_storeId_cycleStartDate", (q) =>
            q.eq("storeId", storeId),
          )
          .take(402);
        expect(accepted).toHaveLength(401);
      }
    });

    vi.useFakeTimers();
    try {
      expect(
        await t.run(async (ctx) =>
          removeOrganizationWithCtx(ctx, seeded.removed.organizationId),
        ),
      ).toBe(false);

      await t.run(async (ctx) => {
        const firstStoreRemaining = await ctx.db
          .query("reportWeekAccepted")
          .withIndex("by_storeId_cycleStartDate", (q) =>
            q.eq("storeId", seeded.removed.storeIds[0]!),
          )
          .take(402);
        expect(firstStoreRemaining).toHaveLength(301);
        expect(await weeklyRowCounts(ctx, seeded.removed.storeIds[1]!)).toEqual([
          0, 10, 0,
        ]);
        expect(await weeklyRowCounts(ctx, seeded.retained.storeIds[0]!)).toEqual([
          1, 1, 1,
        ]);
      });

      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }

    await t.run(async (ctx) => {
      for (const storeId of seeded.removed.storeIds) {
        expect(await weeklyRowCounts(ctx, storeId)).toEqual([0, 0, 0]);
      }
      expect(await weeklyRowCounts(ctx, seeded.retained.storeIds[0]!)).toEqual([
        1, 1, 1,
      ]);
    });
  });

  it("continues weekly cleanup across an organization with 101 stores", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => ({
      removed: await seedOrganization(ctx, "many-store-org", 101),
      retained: await seedOrganization(ctx, "many-store-retained-org", 1),
    }));

    vi.useFakeTimers();
    try {
      expect(
        await t.run(async (ctx) =>
          removeOrganizationWithCtx(ctx, seeded.removed.organizationId),
        ),
      ).toBe(false);

      await t.run(async (ctx) => {
        expect(
          await ctx.db.get("organization", seeded.removed.organizationId),
        ).not.toBeNull();
        expect(await weeklyRowCounts(ctx, seeded.removed.storeIds[0]!)).toEqual([
          0, 0, 0,
        ]);
        expect(await weeklyRowCounts(ctx, seeded.removed.storeIds[50]!)).toEqual([
          1, 1, 1,
        ]);
      });

      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }

    await t.run(async (ctx) => {
      expect(
        await ctx.db.get("organization", seeded.removed.organizationId),
      ).toBeNull();
      for (const storeId of seeded.removed.storeIds) {
        expect(await weeklyRowCounts(ctx, storeId)).toEqual([0, 0, 0]);
      }
      expect(await weeklyRowCounts(ctx, seeded.retained.storeIds[0]!)).toEqual([
        1, 1, 1,
      ]);
    });
  });
});
