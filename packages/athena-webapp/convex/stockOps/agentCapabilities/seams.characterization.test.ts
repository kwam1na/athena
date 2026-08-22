/// <reference types="vite/client" />
/**
 * Characterization of the stock seams the `inventory.*` agent package reshapes
 * (V26-1267, posture: characterization-first).
 *
 * `listInventorySnapshotWithCtx` returns raw `_id`s and a cost basis in the
 * same row: it is a trusted operator read. Both properties are exactly what the
 * agent resource must change — the id becomes an opaque ref and the cost basis
 * becomes a projection that fails closed without cost-overlay authority — so
 * the current shape is pinned here first.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import type { AgentReadPortHandlerInput } from "../../agentHarness/readPorts";
import schema from "../../schema";
import { getInventoryUnitSummaryWithCtx, listInventorySnapshotWithCtx } from "../adjustments";
import { listReplenishmentRecommendationsWithCtx } from "../replenishment";
import { seedDailyOperationsStore } from "../../agentHarness/evals/dailyOperations.fixture";
import { listReplenishmentHandler } from "./inventoryPorts";
import { REPLENISHMENT_PORT_KEY } from "./inventory";

const modules = import.meta.glob("../../**/*.ts");

describe("stock seams (characterization)", () => {
  it("returns raw ids, catalogue identity, and a cost basis on every position row", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run((ctx) => seedDailyOperationsStore(ctx));
    const rows = await t.run((ctx) => listInventorySnapshotWithCtx(ctx, { storeId: fixture.storeId }));

    expect(rows).toHaveLength(2);
    const low = rows.find((row) => row.sku === "BD-12")!;
    expect(low._id).toBe(fixture.lowStockSkuId);
    expect(low.productName).toBe("Bundle deal");
    expect(low.productCategory).toBe("Hair");
    expect(low.productSubcategory).toBe("Wigs");
    expect(low.inventoryCount).toBe(1);
    expect(low.quantityAvailable).toBe(1);
    // Price and net price ride along on the operator read.
    expect(low.price).toBe(40_000);
    expect(low.netPrice).toBe(40_000);
    // Rows are ordered by product name then SKU.
    expect(rows.map((row) => row.sku)).toEqual(["BD-12", "BD-16"]);
  });

  it("summarises unit counts across the store's active SKUs", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run((ctx) => seedDailyOperationsStore(ctx));
    const summary = await t.run((ctx) => getInventoryUnitSummaryWithCtx(ctx, { storeId: fixture.storeId }));
    expect(summary.skuCount).toBe(2);
    expect(summary.onHandUnits).toBe(25);
    expect(summary.availableUnits).toBe(25);
    expect(summary.hasMoreSkus).toBe(false);
  });

  it("recommends replenishment only for SKUs under pressure or with purchase-order context", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run((ctx) => seedDailyOperationsStore(ctx));
    const recommendations = await t.run((ctx) =>
      listReplenishmentRecommendationsWithCtx(ctx, { storeId: fixture.storeId }),
    );

    // Only the low-stock SKU qualifies; the healthy one is not recommended.
    expect(recommendations).toHaveLength(1);
    const recommendation = recommendations[0];
    expect(recommendation._id).toBe(fixture.lowStockSkuId);
    expect(recommendation.sku).toBe("BD-12");
    expect(recommendation.inventoryCount).toBe(1);
    expect(recommendation.quantityAvailable).toBe(1);
    expect(recommendation.status).toBe("exposed");
    expect(recommendation.needsAction).toBe(true);
    expect(recommendation.suggestedOrderQuantity).toBeGreaterThan(0);
    expect(typeof recommendation.guidance).toBe("string");
  });
});

describe("inventory.replenishment read ceiling", () => {
  it("bounds the catalogue scan and reports the page as truncated when the ceiling is reached", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const seeded = await seedDailyOperationsStore(ctx, { slug: "replenishment-ceiling" });
      const lowStockSku = await ctx.db.get("productSku", seeded.lowStockSkuId);
      // More SKUs than REPLENISHMENT_SKU_CEILING (200), every one under pressure
      // so the ceiling, not the pressure filter, is what bounds the answer.
      for (let index = 0; index < 250; index += 1) {
        await ctx.db.insert("productSku", {
          images: [],
          inventoryCount: 1,
          price: 10_000,
          netPrice: 10_000,
          productId: lowStockSku!.productId,
          productName: `Pressure ${String(index).padStart(3, "0")}`,
          quantityAvailable: 1,
          sku: `PR-${String(index).padStart(3, "0")}`,
          storeId: seeded.storeId,
        });
      }
      return seeded;
    });

    const input: AgentReadPortHandlerInput = {
      portKey: REPLENISHMENT_PORT_KEY,
      capabilityId: "inventory.replenishment",
      verb: "list",
      scope: { kind: "store", storeId: fixture.storeId, organizationId: fixture.organizationId },
      args: {},
      pageIndex: 0,
      pageSize: 100,
      grantedProjections: [],
      now: Date.now(),
    };
    const output = await t.run((ctx) => listReplenishmentHandler(ctx, input));

    expect(output.kind).toBe("data");
    if (output.kind !== "data") throw new Error("unreachable");
    expect(output.sources.find((source) => source.sourceKey === "recommendations")).toMatchObject({
      status: "truncated",
      reason: "sku_ceiling_reached",
    });
    // The page stays at the manifest's bound even though the catalogue is larger.
    expect((output.data as unknown[]).length).toBe(100);
  });

  it("reports the recommendations source as complete when the catalogue fits under the ceiling", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run((ctx) => seedDailyOperationsStore(ctx, { slug: "replenishment-small" }));
    const output = await t.run((ctx) =>
      listReplenishmentHandler(ctx, {
        portKey: REPLENISHMENT_PORT_KEY,
        capabilityId: "inventory.replenishment",
        verb: "list",
        scope: { kind: "store", storeId: fixture.storeId, organizationId: fixture.organizationId },
        args: {},
        pageIndex: 0,
        pageSize: 100,
        grantedProjections: [],
        now: Date.now(),
      }),
    );

    expect(output.kind).toBe("data");
    if (output.kind !== "data") throw new Error("unreachable");
    expect(output.sources.find((source) => source.sourceKey === "recommendations")).toMatchObject({ status: "complete" });
    expect((output.data as unknown[]).length).toBe(1);
  });
});
