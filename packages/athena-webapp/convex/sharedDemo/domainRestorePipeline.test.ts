/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { seedStore } from "../reports/reseedTestSupport";
import { insertOperationalWorkItemWithInventoryWithCtx } from "../operations/inventoryContributions";
import { SHARED_DEMO_BASELINE_VERSION } from "./config";
import {
  restoreMutableDemoStoreRowsWithCtx,
  SHARED_DEMO_MUTABLE_TABLES,
} from "./domainRestore";
import { enqueueReportWork } from "../reports/pipelineWork";
import { applyRestoreLeaseWithCtx } from "./restore";
const modules = import.meta.glob("../**/*.ts");
const skipTables = SHARED_DEMO_MUTABLE_TABLES.filter(
  (entry) => entry.tableName !== "operationalWorkItem",
).map((entry) => entry.tableName);
afterEach(() => vi.useRealTimers());

describe("demo restore compact Operations projection", () => {
  it("stages cleanup under the existing lease without touching source rows or accepting a stale coordinator", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx, "UTC");
      const controlId = await ctx.db.insert("reportPipelineControl", {
        storeId: store.storeId,
        mode: "active",
        fence: 4,
        sourceWatermark: 0,
        activeRollupEpoch: "old",
      });
      const stateId = await ctx.db.insert("sharedDemoRestoreState", {
        storeId: store.storeId,
        baselineVersion: SHARED_DEMO_BASELINE_VERSION,
        epoch: 2,
        idempotencyKey: "restore-2",
        phase: "leased",
        status: "restoring",
      });
      for (let index = 0; index < 150; index++)
        await enqueueReportWork(
          ctx,
          {
            storeId: store.storeId,
            kind: "rollup",
            operatingDate: new Date(Date.UTC(2026, 0, index + 1))
              .toISOString()
              .slice(0, 10),
          },
          100,
        );
      return { ...store, controlId, stateId };
    });
    await expect(
      t.run((ctx) =>
        restoreMutableDemoStoreRowsWithCtx(ctx, seeded.storeId, { skipTables }),
      ),
    ).rejects.toThrow("staged restore lease");
    await t.run(async (ctx) => {
      expect(
        await ctx.db.get("reportPipelineControl", seeded.controlId),
      ).toMatchObject({ fence: 4, mode: "active" });
      expect(await ctx.db.query("reportPipelineWork").take(151)).toHaveLength(
        150,
      );
    });
    expect(
      await t.run((ctx) =>
        applyRestoreLeaseWithCtx(ctx, {
          storeId: seeded.storeId,
          epoch: 2,
          idempotencyKey: "restore-2",
          source: "manual",
          now: 200,
        }),
      ),
    ).toEqual({ pending: true });
    await t.run(async (ctx) => {
      expect(
        await ctx.db.get("reportPipelineControl", seeded.controlId),
      ).toMatchObject({ fence: 5, mode: "paused", hasActivated: true });
      expect(
        await ctx.db.get("sharedDemoRestoreState", seeded.stateId),
      ).toMatchObject({ phase: "leased", status: "restoring" });
      expect(await ctx.db.query("reportPipelineWork").take(151)).toHaveLength(
        50,
      );
      expect(await ctx.db.get("productSku", seeded.skuId)).not.toBeNull();
    });
    await expect(
      t.run((ctx) =>
        applyRestoreLeaseWithCtx(ctx, {
          storeId: seeded.storeId,
          epoch: 1,
          idempotencyKey: "old",
          source: "manual",
          now: 201,
        }),
      ),
    ).rejects.toThrow("lease changed");
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineWork").take(151)),
    ).toHaveLength(50);
  });
  it("projects final remapped Work Items, removes deleted inputs and starts incomplete source coverage", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx, "UTC");
      const controlId = await ctx.db.insert("reportPipelineControl", {
        storeId: store.storeId,
        mode: "shadow",
        fence: 7,
        sourceWatermark: 0,
        hasActivated: true,
      });
      const input = {
        storeId: store.storeId,
        organizationId: store.organizationId,
        type: "synced_sale_inventory_review",
        status: "open",
        priority: "normal",
        approvalState: "not_required",
        title: "Baseline review",
        createdAt: 100,
        productSkuId: store.skuId,
      };
      const oldId = await insertOperationalWorkItemWithInventoryWithCtx(
        ctx,
        input,
      );
      await ctx.db.insert("sharedDemoBaselineDocument", {
        baselineVersion: SHARED_DEMO_BASELINE_VERSION,
        storeId: store.storeId,
        tableName: "operationalWorkItem",
        documentId: oldId,
        document: input,
      });
      await ctx.db.delete("operationalWorkItem", oldId);
      const extraId = await insertOperationalWorkItemWithInventoryWithCtx(ctx, {
        ...input,
        title: "Later review",
      });
      return { ...store, oldId, extraId, controlId };
    });
    await t.run((ctx) =>
      restoreMutableDemoStoreRowsWithCtx(ctx, seeded.storeId, { skipTables }),
    );
    await t.run(async (ctx) => {
      // Purge fences the old pipeline once; final baseline publication must
      // independently invalidate proofs over any restored accepted-week rows.
      expect(
        await ctx.db.get("reportPipelineControl", seeded.controlId),
      ).toMatchObject({
        mode: "shadow",
        fence: 9,
        hasActivated: true,
      });
      const restored = (await ctx.db
        .query("operationalWorkItem")
        .withIndex("by_storeId", (q) => q.eq("storeId", seeded.storeId))
        .unique())!;
      expect(restored._id).not.toBe(seeded.oldId);
      expect(restored._id).not.toBe(seeded.extraId);
      expect(
        await ctx.db
          .query("operationalInventoryContribution")
          .withIndex("by_workItemId", (q) => q.eq("workItemId", restored._id))
          .unique(),
      ).toMatchObject({ storeId: seeded.storeId, productSkuId: seeded.skuId });
      expect(
        await ctx.db
          .query("operationalInventoryContribution")
          .withIndex("by_workItemId", (q) => q.eq("workItemId", seeded.extraId))
          .unique(),
      ).toBeNull();
      expect(
        await ctx.db
          .query("operationalInventoryCoverage")
          .withIndex("by_storeId", (q) => q.eq("storeId", seeded.storeId))
          .unique(),
      ).toMatchObject({ complete: false, rebuild: { phase: "work" } });
      expect(
        await ctx.db.query("sharedDemoBaselineDocument").take(2),
      ).toHaveLength(1);
    });
  });

  it("rejects a foreign store hidden inside an otherwise store-scoped baseline", async () => {
    const t = convexTest(schema, modules);
    const storeId = await t.run(async (ctx) => {
      const store = await seedStore(ctx, "UTC");
      const foreign = await seedStore(ctx, "UTC");
      const document = {
        storeId: foreign.storeId,
        organizationId: foreign.organizationId,
        type: "synced_sale_inventory_review",
        status: "open",
        priority: "normal",
        approvalState: "not_required",
        title: "Foreign",
        createdAt: 100,
      };
      const id = await ctx.db.insert("operationalWorkItem", document);
      await ctx.db.insert("sharedDemoBaselineDocument", {
        baselineVersion: SHARED_DEMO_BASELINE_VERSION,
        storeId: store.storeId,
        tableName: "operationalWorkItem",
        documentId: id,
        document,
      });
      return store.storeId;
    });
    await expect(
      t.run((ctx) =>
        restoreMutableDemoStoreRowsWithCtx(ctx, storeId, { skipTables }),
      ),
    ).rejects.toThrow("ownership");
    expect(
      await t.run((ctx) => ctx.db.query("operationalWorkItem").take(3)),
    ).toHaveLength(1);
  });
});
