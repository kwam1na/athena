/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { seedStore } from "../reports/reseedTestSupport";
import { recordReadCosts } from "../reports/readCostTestSupport";
import {
  insertOperationalWorkItemWithInventoryWithCtx,
  readCompactInventoryAttention,
} from "./inventoryContributions";
import {
  beginInventoryContributionRebuildWithCtx,
  stepInventoryContributionRebuildWithCtx,
} from "./inventoryContributionRebuild";
const modules = import.meta.glob("../**/*.ts");

describe("bounded inventory source rebuild", () => {
  it("keeps coverage false across source pages, repairs stale inputs and fences a restarted cursor", async () => {
    const t = convexTest(schema, modules);
    const { storeId, organizationId } = await t.run((ctx) =>
      seedStore(ctx, "UTC"),
    );
    const input = {
      storeId,
      organizationId,
      type: "synced_sale_inventory_review",
      status: "open",
      priority: "normal",
      approvalState: "not_required",
      title: "private",
      createdAt: 100,
    };
    const staleId = await t.run((ctx) =>
      insertOperationalWorkItemWithInventoryWithCtx(ctx, input),
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("operationalWorkItem", staleId); // deliberately broken historical coverage
      await ctx.db.insert("operationalWorkItem", input);
      await ctx.db.insert("operationalWorkItem", {
        ...input,
        status: "in_progress",
      });
    });
    const oldGeneration = await t.run((ctx) =>
      beginInventoryContributionRebuildWithCtx(ctx, storeId, 1_000),
    );
    const generation = await t.run((ctx) =>
      beginInventoryContributionRebuildWithCtx(ctx, storeId, 1_001),
    );
    expect(
      await t.run((ctx) =>
        stepInventoryContributionRebuildWithCtx(
          ctx,
          { storeId, generation: oldGeneration },
          1_002,
        ),
      ),
    ).toEqual({ status: "stale" });
    let completed = false;
    for (let index = 0; index < 30; index++) {
      const result = await t.run(async (ctx) => {
        expect(
          (await readCompactInventoryAttention(ctx, storeId, 0)).completeness,
        ).toBe("unavailable");
        const measured = recordReadCosts(ctx);
        const step = await stepInventoryContributionRebuildWithCtx(
          measured.ctx,
          { storeId, generation },
          1_010 + index,
        );
        expect(
          (measured.snapshot().byTable.operationalWorkItem?.returnedDocuments ??
            0) +
            (measured.snapshot().byTable.oversizedOperationalWorkRepair
              ?.returnedDocuments ?? 0),
        ).toBeLessThanOrEqual(1);
        return step;
      });
      if (result.status === "complete") {
        completed = true;
        break;
      }
    }
    expect(completed).toBe(true);
    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("operationalInventoryContribution")
          .withIndex("by_workItemId", (q) => q.eq("workItemId", staleId))
          .unique(),
      ).toBeNull();
      expect(
        await readCompactInventoryAttention(ctx, storeId, 0),
      ).toMatchObject({ completeness: "complete", observedCount: 2 });
    });
  });
});
