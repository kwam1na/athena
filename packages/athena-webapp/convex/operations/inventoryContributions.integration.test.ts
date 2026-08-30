/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { seedStore } from "../reports/reseedTestSupport";
import { recordReadCosts } from "../reports/readCostTestSupport";
import { listOpenSyncedSaleInventoryReviewGroupsWithCompleteness } from "./operationalWorkItems";
import { projectLiveWeeklyInventoryAttention } from "../reports/weeklyInventory";
import { createConvexLocalSyncRepository } from "../pos/infrastructure/repositories/localSyncRepository";
import {
  deleteOperationalWorkItemWithInventoryWithCtx,
  insertOperationalWorkItemWithInventoryWithCtx,
  patchInventoryRepairWithCtx,
  patchOperationalWorkItemWithInventoryWithCtx,
  readCompactInventoryAttention,
  setInventoryCoverageWithCtx,
  syncInventoryContributionWithCtx,
  syncInventoryRepairWithCtx,
} from "./inventoryContributions";

const modules = import.meta.glob("../**/*.ts");
const NOW = 1_000;
async function fixture() {
  const t = convexTest(schema, modules);
  const store = await t.run((ctx) => seedStore(ctx, "UTC"));
  const input = {
    storeId: store.storeId,
    organizationId: store.organizationId,
    type: "synced_sale_inventory_review",
    status: "open",
    priority: "normal",
    approvalState: "not_required",
    title: "Private detail",
    createdAt: 900,
    productSkuId: store.skuId,
    metadata: { localTransactionId: "one", privateSource: "x".repeat(12_000) },
  };
  return { t, store, input };
}

describe("atomic Operations inventory inputs", () => {
  it("covers the actual POS repository creation seam", async () => {
    const { t, input } = await fixture();
    await t.run(async (ctx) => {
      const id =
        await createConvexLocalSyncRepository(ctx).createServiceWorkItem(input);
      expect(
        await ctx.db.query("operationalInventoryContribution").unique(),
      ).toMatchObject({ workItemId: id, storeId: input.storeId });
      expect(await ctx.db.query("reportPipelineWork").unique()).toMatchObject({
        storeId: input.storeId,
        kind: "inventory",
      });
    });
  });
  it("creates, merges, changes group identity, resolves and deletes without financial writes", async () => {
    const { t, store, input } = await fixture();
    await t.run(async (ctx) => {
      const id = await insertOperationalWorkItemWithInventoryWithCtx(
        ctx,
        input,
      );
      await setInventoryCoverageWithCtx(ctx, store.storeId, true, NOW);
      const alias = await insertOperationalWorkItemWithInventoryWithCtx(ctx, {
        ...input,
        status: "in_progress",
        createdAt: 1_100,
      });
      expect(
        (await readCompactInventoryAttention(ctx, store.storeId, NOW))
          .groups[0],
      ).toMatchObject({
        memberCount: 2,
        classification: "carried_forward",
        hasNewActivity: true,
      });
      await patchOperationalWorkItemWithInventoryWithCtx(ctx, alias, {
        productSkuId: store.otherSkuId,
      });
      expect(
        (await readCompactInventoryAttention(ctx, store.storeId, NOW)).groups[0]
          .productSkuId,
      ).toBe(store.otherSkuId);
      await patchOperationalWorkItemWithInventoryWithCtx(ctx, alias, {
        status: "completed",
      });
      expect(
        (await readCompactInventoryAttention(ctx, store.storeId, NOW))
          .groups[0],
      ).toMatchObject({ memberCount: 1, productSkuId: store.skuId });
      await deleteOperationalWorkItemWithInventoryWithCtx(
        ctx,
        (await ctx.db.get("operationalWorkItem", id))!,
      );
      expect(
        (await readCompactInventoryAttention(ctx, store.storeId, NOW))
          .observedCount,
      ).toBe(0);
      expect(await ctx.db.query("reportDirtyDay").take(2)).toEqual([]);
      expect(await ctx.db.query("reportWeekCurrent").take(2)).toEqual([]);
      expect(
        (await ctx.db.query("reportPipelineWork").take(2)).map(
          (row) => row.kind,
        ),
      ).toEqual(["inventory"]);
      expect(
        (await ctx.db.get("productSku", store.skuId))!.inventoryCount,
      ).toBe(0);
    });
  });

  it("duplicate transitions are no-ops and reject foreign source contexts", async () => {
    const { t, store, input } = await fixture();
    const id = await t.run((ctx) =>
      insertOperationalWorkItemWithInventoryWithCtx(ctx, input),
    );
    const before = await t.run((ctx) =>
      ctx.db.query("reportPipelineWork").unique(),
    );
    await t.run(async (ctx) => {
      const item = (await ctx.db.get("operationalWorkItem", id))!;
      await syncInventoryContributionWithCtx(
        ctx,
        item,
        { storeId: store.storeId, workItemId: id },
        NOW,
      );
    });
    expect(
      (await t.run((ctx) => ctx.db.query("reportPipelineWork").unique()))!
        .generation,
    ).toBe(before!.generation);
    const foreign = await t.run((ctx) => seedStore(ctx, "UTC"));
    await expect(
      t.run(async (ctx) =>
        syncInventoryContributionWithCtx(
          ctx,
          (await ctx.db.get("operationalWorkItem", id))!,
          { storeId: foreign.storeId, workItemId: id },
          NOW,
        ),
      ),
    ).rejects.toThrow("owner_mismatch");
  });

  it("matches repair begin/pause/complete grouping using only compact rows", async () => {
    const { t, store, input } = await fixture();
    await t.run(async (ctx) => {
      const id = await insertOperationalWorkItemWithInventoryWithCtx(
        ctx,
        input,
      );
      await setInventoryCoverageWithCtx(ctx, store.storeId, true, NOW);
      const contribution = (await ctx.db
        .query("operationalInventoryContribution")
        .unique())!;
      const repairId = await ctx.db.insert("oversizedOperationalWorkRepair", {
        storeId: store.storeId,
        organizationId: store.organizationId,
        groupKey: `synced_sale_inventory_review:${store.storeId}:${store.skuId}`,
        productSkuId: store.skuId,
        sourceIdentities: [contribution.sourceIdentity],
        memberIds: [id],
        cursor: 0,
        status: "pending",
        reason: "Private",
        initiatorIdentifier: "Private",
        supportTicket: "Private",
        createdAt: NOW,
        updatedAt: NOW,
      });
      const repair = (await ctx.db.get(
        "oversizedOperationalWorkRepair",
        repairId,
      ))!;
      await syncInventoryRepairWithCtx(
        ctx,
        repair,
        { storeId: store.storeId, repairId },
        NOW,
      );
      await insertOperationalWorkItemWithInventoryWithCtx(ctx, {
        ...input,
        createdAt: 1_100,
        metadata: { localTransactionId: "two" },
      });
      for (const status of [
        "pending",
        "paused",
        "running",
        "completed",
      ] as const) {
        await patchInventoryRepairWithCtx(ctx, repair, {
          status,
          updatedAt: NOW,
        });
        const recorded = recordReadCosts(ctx);
        const compact = await readCompactInventoryAttention(
          recorded.ctx,
          store.storeId,
          NOW,
        );
        const legacy = projectLiveWeeklyInventoryAttention({
          frameStartAt: NOW,
          logicalWork:
            await listOpenSyncedSaleInventoryReviewGroupsWithCompleteness(
              ctx,
              store.storeId,
            ),
        });
        expect(compact).toEqual(legacy);
        expect(recorded.snapshot().byTable.operationalWorkItem).toBeUndefined();
        expect(
          recorded.snapshot().byTable.oversizedOperationalWorkRepair,
        ).toBeUndefined();
        expect(compact.observedCount).toBe(status === "completed" ? 1 : 2);
        if (status === "pending") {
          const legacyRead = recordReadCosts(ctx);
          await listOpenSyncedSaleInventoryReviewGroupsWithCompleteness(
            legacyRead.ctx,
            store.storeId,
          );
          expect(recorded.snapshot().total.serializedBytes).toBeLessThan(
            legacyRead.snapshot().total.serializedBytes / 3,
          );
          console.info(
            "inventory read fixture (serialized payload proxy, not billing)",
            {
              legacy: legacyRead.snapshot().total,
              compact: recorded.snapshot().total,
            },
          );
        }
      }
    });
  });

  it("refuses absent coverage and retains a cap+1 incompleteness signal", async () => {
    const { t, store, input } = await fixture();
    await t.run(async (ctx) => {
      expect(
        (await readCompactInventoryAttention(ctx, store.storeId, NOW))
          .completeness,
      ).toBe("unavailable");
      await setInventoryCoverageWithCtx(ctx, store.storeId, true, NOW);
      for (let i = 0; i < 501; i++)
        await insertOperationalWorkItemWithInventoryWithCtx(ctx, {
          ...input,
          metadata: { localTransactionId: `sale-${i}` },
        });
      const measured = recordReadCosts(ctx);
      const result = await readCompactInventoryAttention(
        measured.ctx,
        store.storeId,
        NOW,
      );
      expect(result).toMatchObject({
        completeness: "incomplete",
        overflow: true,
      });
      expect(result.groups[0]).toMatchObject({
        evidenceLimited: true,
        memberCount: 500,
      });
      expect(
        measured.snapshot().byTable.operationalInventoryContribution
          .returnedDocuments,
      ).toBe(501);
      expect(measured.snapshot().total.serializedBytes).toBeLessThan(300_000);
    });
  });

  it("keeps oversized source identities bounded and refuses foreign SKU inputs", async () => {
    const { t, store, input } = await fixture();
    await t.run(async (ctx) => {
      await insertOperationalWorkItemWithInventoryWithCtx(ctx, {
        ...input,
        metadata: { localTransactionId: "x".repeat(20_000) },
      });
      await setInventoryCoverageWithCtx(ctx, store.storeId, true, NOW);
      const row = (await ctx.db
        .query("operationalInventoryContribution")
        .unique())!;
      expect(row.complete).toBe(false);
      expect(JSON.stringify(row).length).toBeLessThan(1_024);
      expect(
        await readCompactInventoryAttention(ctx, store.storeId, NOW),
      ).toMatchObject({
        completeness: "incomplete",
        overflow: true,
        groups: [],
      });
    });
    const foreign = await t.run((ctx) => seedStore(ctx, "UTC"));
    await expect(
      t.run((ctx) =>
        insertOperationalWorkItemWithInventoryWithCtx(ctx, {
          ...input,
          productSkuId: foreign.skuId,
        }),
      ),
    ).rejects.toThrow("sku_owner_mismatch");
    expect(
      await t.run((ctx) => ctx.db.query("operationalWorkItem").take(3)),
    ).toHaveLength(1);
  });
});
