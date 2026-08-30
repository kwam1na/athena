/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { seedDailyClose, seedStore } from "./reseedTestSupport";
import { recordReadCosts } from "./readCostTestSupport";
import { aggregateWeeklyCloseEvidence } from "./weeklyCloseEvidence";
import { testId } from "../lib/testIds";
import { foldAndReplaceDay } from "./sweeper";
import {
  closeEvidenceAsSnapshot,
  materializeCloseEvidenceWithCtx,
  normalizeCloseEvidence,
  publishCloseLifecycleWithCtx,
  supersedeCloseEvidenceWithCtx,
  readCloseEvidenceWithCtx,
  CLOSE_EVIDENCE_MAX_CHUNKS,
  CLOSE_EVIDENCE_MAX_NORMALIZED_BYTES,
  cleanupCloseEvidenceGenerationsWithCtx,
  compactFrozenInventoryAttention,
} from "./closeEvidence";
import { projectFrozenWeeklyInventoryAttention } from "./weeklyInventory";

const modules = import.meta.glob("../**/*.ts");
const NOW = Date.parse("2026-08-29T20:00:00Z");

async function fixture() {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const store = await seedStore(ctx, "UTC");
    const closeId = await seedDailyClose(ctx, store, {
      completedAt: NOW,
      operatingDate: "2026-08-29",
      salesTotal: 100,
    });
    const workId = await ctx.db.insert("operationalWorkItem", {
      storeId: store.storeId,
      organizationId: store.organizationId,
      type: "synced_sale_inventory_review",
      status: "open",
      priority: "normal",
      approvalState: "not_required",
      title: "Private source detail",
      createdAt: NOW,
    });
    await ctx.db.patch("dailyClose", closeId, {
      summary: { salesTotal: 100, transactionCount: 2 },
      reportSnapshot: {
        closeMetadata: {
          storeId: store.storeId,
          organizationId: store.organizationId,
          operatingDate: "2026-08-29",
          startAt: NOW - 1000,
          endAt: NOW,
          completedAt: NOW,
          carryForwardWorkItemIds: [],
          notes: "NOT REPORTING EVIDENCE",
        },
        readiness: {
          status: "ready",
          blockerCount: 0,
          reviewCount: 0,
          carryForwardCount: 0,
          readyCount: 0,
        },
        reviewedItems: [],
        carryForwardItems: [],
        readyItems: [],
        sourceSubjects: [],
        summary: {
          netCashVariance: -10,
          transactionCount: 2,
          paymentTotals: [{ method: "Cash", amount: 100, transactionCount: 2 }],
        },
        expenseProductEvidence: {
          contractVersion: 1,
          status: "complete",
          expenseTotal: 20,
          sourceItemCount: 1,
          sourceTransactionCount: 1,
          products: [
            {
              productSkuId: store.skuId,
              productName: "Tea",
              productSku: "TEA",
              quantity: 2,
              spend: 20,
            },
          ],
        },
        openWorkMembership: {
          completeness: "complete",
          observedLogicalCount: 1,
        },
        frozenSyncedSaleInventoryReviewGroups: [
          {
            key: "review",
            productSkuId: store.skuId,
            membershipCompleteness: "complete",
            oldestActionableAt: NOW - 100,
            members: [
              { createdAt: NOW - 100, workItemId: workId },
              { createdAt: NOW + 100, workItemId: workId },
            ],
          },
        ],
      },
    });
    return { ...store, closeId, workId };
  });
  const source = await t.run((ctx) => ctx.db.get("dailyClose", seeded.closeId));
  if (!source) throw new Error("missing close fixture");
  return { t, seeded, source };
}

describe("compact close evidence", () => {
  it("keeps complete expense inputs and compact membership without private payload", async () => {
    const { source } = await fixture();
    const normalized = normalizeCloseEvidence(source);
    expect(normalized.lanes).toEqual({
      cash: "complete",
      transactions: "complete",
      payments: "complete",
      expenses: "complete",
      inventory: "complete",
    });
    expect(normalized.items).toContainEqual({
      kind: "inventory",
      key: "review",
      productSkuId: expect.any(String),
      memberCount: 2,
      firstCreatedAt: NOW - 100,
      lastCreatedAt: NOW + 100,
    });
    expect(JSON.stringify(normalized)).not.toContain("private-member");
    expect(JSON.stringify(normalized)).not.toContain("NOT REPORTING");
  });

  it("materializes a near-document-limit close without copying its source detail", async () => {
    const { t, source, seeded } = await fixture();
    await t.run(async (ctx) => {
      await ctx.db.patch("dailyClose", seeded.closeId, {
        reportSnapshot: {
          ...source.reportSnapshot!,
          closeMetadata: {
            ...source.reportSnapshot!.closeMetadata,
            notes: "x".repeat(960 * 1024),
          },
        },
      });
      await publishCloseLifecycleWithCtx(ctx, source, NOW);
    });
    const result = await t.run(async (ctx) => {
      const recorder = recordReadCosts(ctx);
      const outcome = await materializeCloseEvidenceWithCtx(recorder.ctx, {
        storeId: seeded.storeId,
        closeId: seeded.closeId,
        expectedGeneration: 1,
      });
      return { outcome, cost: recorder.snapshot() };
    });
    expect(result.outcome.status).toBe("published");
    expect(result.cost.byTable.dailyClose.returnedDocuments).toBe(1);
    expect(result.cost.total.serializedBytes).toBeLessThan(1024 * 1024);
    expect(result.cost.total.serializedBytes).toBeGreaterThan(960 * 1024);
    const read = await t.run(async (ctx) => {
      const recorder = recordReadCosts(ctx);
      await readCloseEvidenceWithCtx(
        recorder.ctx,
        seeded.storeId,
        seeded.closeId,
      );
      return recorder.snapshot();
    });
    expect(read.total.serializedBytes).toBeLessThan(4 * 1024);
    expect(read.byTable.dailyClose).toBeUndefined();
  });

  it("distinguishes missing, malformed and empty evidence", async () => {
    const { source } = await fixture();
    expect(
      normalizeCloseEvidence({ ...source, reportSnapshot: undefined }).lanes,
    ).toEqual({
      cash: "unavailable",
      transactions: "unavailable",
      payments: "unavailable",
      expenses: "unavailable",
      inventory: "unavailable",
    });
    const invalid = normalizeCloseEvidence({
      ...source,
      reportSnapshot: {
        summary: {
          paymentTotals: [{ method: "Cash", amount: -1, transactionCount: 1 }],
        },
      },
    });
    expect(invalid.lanes.payments).toBe("invalid");
    const empty = normalizeCloseEvidence({
      ...source,
      reportSnapshot: {
        summary: { netCashVariance: 0, transactionCount: 0, paymentTotals: [] },
        expenseProductEvidence: {
          contractVersion: 1,
          status: "complete",
          expenseTotal: 0,
          sourceItemCount: 0,
          sourceTransactionCount: 0,
          products: [],
        },
        openWorkMembership: { completeness: "complete" },
        frozenSyncedSaleInventoryReviewGroups: [],
      },
    });
    expect(empty.items).toEqual([]);
    expect(Object.values(empty.lanes)).toEqual(Array(5).fill("complete"));
  });

  it("publishes a scalar mandatory handoff without reading the source or children", async () => {
    const { t, source, seeded } = await fixture();
    const result = await t.run(async (ctx) => {
      const recorder = recordReadCosts(ctx);
      const header = await publishCloseLifecycleWithCtx(
        recorder.ctx,
        source,
        NOW,
      );
      return { header, reads: recorder.snapshot() };
    });
    expect(result.header.expectedGeneration).toBe(1);
    expect(result.header.publishedGeneration).toBeUndefined();
    expect(result.reads.byTable.dailyClose).toBeUndefined();
    expect(result.reads.byTable.reportCloseEvidenceChunk).toBeUndefined();
    const work = await t.run((ctx) =>
      ctx.db.query("reportPipelineWork").take(10),
    );
    expect(work).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          storeId: seeded.storeId,
          kind: "close-evidence",
          closeId: seeded.closeId,
        }),
      ]),
    );
  });

  it("reads one source per generation and replays published work without hydration", async () => {
    const { t, source, seeded } = await fixture();
    const header = await t.run((ctx) =>
      publishCloseLifecycleWithCtx(ctx, source, NOW),
    );
    const args = {
      storeId: seeded.storeId,
      closeId: seeded.closeId,
      expectedGeneration: header.expectedGeneration,
    };
    const result = await t.run(async (ctx) => {
      const recorder = recordReadCosts(ctx);
      const outcome = await materializeCloseEvidenceWithCtx(recorder.ctx, args);
      return { outcome, reads: recorder.snapshot() };
    });
    expect(result.outcome.status).toBe("published");
    expect(result.reads.byTable.dailyClose.returnedDocuments).toBe(1);
    const replay = await t.run(async (ctx) => {
      const recorder = recordReadCosts(ctx);
      const outcome = await materializeCloseEvidenceWithCtx(recorder.ctx, args);
      return { outcome, reads: recorder.snapshot() };
    });
    expect(replay.outcome.status).toBe("already-published");
    expect(replay.reads.byTable.dailyClose).toBeUndefined();
    const compact = await t.run((ctx) =>
      readCloseEvidenceWithCtx(ctx, seeded.storeId, seeded.closeId),
    );
    expect(compact.status).toBe("ready");
    if (compact.status !== "ready") throw new Error("not ready");
    const original = source as Parameters<
      typeof aggregateWeeklyCloseEvidence
    >[0]["closes"] extends ReadonlyMap<string, infer Close>
      ? Close
      : never;
    const aggregate = (close: typeof original) =>
      aggregateWeeklyCloseEvidence({
        closes: new Map([[String(source._id), close]]),
        days: [{ operatingDate: source.operatingDate, closeId: source._id }],
        scheduledDates: [source.operatingDate],
      });
    expect(aggregate(closeEvidenceAsSnapshot(compact))).toEqual(
      aggregate(original),
    );
    expect(compactFrozenInventoryAttention(compact, NOW)).toEqual(
      projectFrozenWeeklyInventoryAttention({
        frameStartAt: NOW,
        groups: source.reportSnapshot!.frozenSyncedSaleInventoryReviewGroups!,
        membershipCompleteness: "complete",
      }),
    );
  });

  it("invalidates immediately on reopen and fences an older materializer", async () => {
    const { t, source, seeded } = await fixture();
    const first = await t.run((ctx) =>
      publishCloseLifecycleWithCtx(ctx, source, NOW),
    );
    await t.run((ctx) =>
      materializeCloseEvidenceWithCtx(ctx, {
        storeId: seeded.storeId,
        closeId: seeded.closeId,
        expectedGeneration: first.expectedGeneration,
      }),
    );
    const reopened = await t.run(async (ctx) => {
      await ctx.db.patch("dailyClose", seeded.closeId, {
        lifecycleStatus: "reopened",
        reopenedAt: NOW + 1,
        updatedAt: NOW + 1,
      });
      const current = await ctx.db.get("dailyClose", seeded.closeId);
      if (!current) throw new Error("missing close");
      return publishCloseLifecycleWithCtx(ctx, current, NOW + 1);
    });
    expect(reopened.expectedGeneration).toBe(2);
    expect(reopened.publishedGeneration).toBeUndefined();
    expect(
      await t.run((ctx) =>
        materializeCloseEvidenceWithCtx(ctx, {
          storeId: seeded.storeId,
          closeId: seeded.closeId,
          expectedGeneration: 1,
        }),
      ),
    ).toEqual({ status: "stale" });
    expect(
      (
        await t.run((ctx) =>
          readCloseEvidenceWithCtx(ctx, seeded.storeId, seeded.closeId),
        )
      ).status,
    ).toBe("pending");
  });

  it("refuses foreign work and foreign-parent generation chunks", async () => {
    const { t, source, seeded } = await fixture();
    const other = await t.run((ctx) => seedStore(ctx, "UTC"));
    const header = await t.run((ctx) =>
      publishCloseLifecycleWithCtx(ctx, source, NOW),
    );
    expect(
      await t.run((ctx) =>
        materializeCloseEvidenceWithCtx(ctx, {
          storeId: other.storeId,
          closeId: seeded.closeId,
          expectedGeneration: 1,
        }),
      ),
    ).toEqual({ status: "blocked", reason: "ownership_mismatch" });
    await t.run((ctx) =>
      materializeCloseEvidenceWithCtx(ctx, {
        storeId: seeded.storeId,
        closeId: seeded.closeId,
        expectedGeneration: header.expectedGeneration,
      }),
    );
    await t.run(async (ctx) => {
      const chunk = await ctx.db.query("reportCloseEvidenceChunk").first();
      if (!chunk) throw new Error("missing chunk");
      await ctx.db.patch("reportCloseEvidenceChunk", chunk._id, {
        storeId: other.storeId,
      });
    });
    expect(
      await t.run((ctx) =>
        readCloseEvidenceWithCtx(ctx, seeded.storeId, seeded.closeId),
      ),
    ).toMatchObject({ status: "blocked", reason: "ownership_mismatch" });
  });

  it("invalidates an unbackfilled predecessor without hydrating it in the source transaction", async () => {
    const { t, seeded } = await fixture();
    const shell = await t.run(async (ctx) => {
      const successor = await seedDailyClose(ctx, seeded, {
        completedAt: NOW + 1,
        operatingDate: "2026-08-29",
        salesTotal: 100,
      });
      await ctx.db.patch("dailyClose", seeded.closeId, {
        lifecycleStatus: "superseded",
        supersededByDailyCloseId: successor,
        updatedAt: NOW + 1,
      });
      const recorder = recordReadCosts(ctx);
      const header = await supersedeCloseEvidenceWithCtx(
        recorder.ctx,
        {
          storeId: seeded.storeId,
          closeId: seeded.closeId,
          operatingDate: "2026-08-29",
          supersededByCloseId: successor,
        },
        NOW + 1,
      );
      expect(recorder.snapshot().byTable.dailyClose).toBeUndefined();
      return header;
    });
    expect(shell.completedAt).toBeUndefined();
    expect(shell.closeNetSalesMinor).toBeUndefined();
    expect(
      (
        await t.run((ctx) =>
          materializeCloseEvidenceWithCtx(ctx, {
            storeId: seeded.storeId,
            closeId: seeded.closeId,
            expectedGeneration: shell.expectedGeneration,
          }),
        )
      ).status,
    ).toBe("published");
  });

  it("rolls back source state when mandatory invalidation cannot persist", async () => {
    const { t, source, seeded } = await fixture();
    await expect(
      t.run(async (ctx) => {
        await ctx.db.patch("dailyClose", seeded.closeId, {
          lifecycleStatus: "reopened",
          updatedAt: NOW + 1,
        });
        const db = new Proxy(ctx.db, {
          get(target, property) {
            if (property === "insert")
              return async (table: string) => {
                if (table === "reportCloseEvidence")
                  throw new Error("injected handoff failure");
                throw new Error("unexpected fixture write");
              };
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        await publishCloseLifecycleWithCtx(
          { ...ctx, db } as MutationCtx,
          { ...source, lifecycleStatus: "reopened", updatedAt: NOW + 1 },
          NOW + 1,
        );
      }),
    ).rejects.toThrow("injected handoff failure");
    expect(
      (await t.run((ctx) => ctx.db.get("dailyClose", seeded.closeId)))
        ?.lifecycleStatus,
    ).toBeUndefined();
  });

  it("never publishes or retains partial children when the final header write fails", async () => {
    const { t, source, seeded } = await fixture();
    await t.run((ctx) => publishCloseLifecycleWithCtx(ctx, source, NOW));
    await expect(
      t.run(async (ctx) => {
        const db = new Proxy(ctx.db, {
          get(target, property) {
            if (property === "patch")
              return async () => {
                throw new Error("injected publication failure");
              };
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        await materializeCloseEvidenceWithCtx({ ...ctx, db } as MutationCtx, {
          storeId: seeded.storeId,
          closeId: seeded.closeId,
          expectedGeneration: 1,
        });
      }),
    ).rejects.toThrow("injected publication failure");
    expect(
      await t.run((ctx) => ctx.db.query("reportCloseEvidenceChunk").take(10)),
    ).toEqual([]);
    expect(
      (await t.run((ctx) => ctx.db.query("reportCloseEvidence").first()))
        ?.publishedGeneration,
    ).toBeUndefined();
    expect(
      (await t.run((ctx) => ctx.db.get("dailyClose", seeded.closeId)))?.status,
    ).toBe("completed");
    expect(
      (await t.run((ctx) => ctx.db.query("reportPipelineWork").take(10)))
        .length,
    ).toBeGreaterThan(0);
  });

  it("retains unpublished work on capacity refusal and refuses foreign snapshot ownership", async () => {
    const { t, source, seeded } = await fixture();
    await t.run(async (ctx) => {
      await ctx.db.patch("dailyClose", seeded.closeId, {
        reportSnapshot: {
          ...source.reportSnapshot!,
          expenseProductEvidence: {
            contractVersion: 1,
            status: "complete",
            expenseTotal: 1,
            sourceItemCount: 1,
            sourceTransactionCount: 1,
            products: [
              {
                productSkuId: seeded.skuId,
                productName: "x".repeat(40_000),
                productSku: "x",
                quantity: 1,
                spend: 1,
              },
            ],
          },
        },
      });
      await publishCloseLifecycleWithCtx(ctx, source, NOW);
    });
    expect(
      await t.run((ctx) =>
        materializeCloseEvidenceWithCtx(ctx, {
          storeId: seeded.storeId,
          closeId: seeded.closeId,
          expectedGeneration: 1,
        }),
      ),
    ).toEqual({ status: "blocked", reason: "capacity_exceeded" });
    expect(
      (await t.run((ctx) => ctx.db.query("reportCloseEvidence").first()))
        ?.publishedGeneration,
    ).toBeUndefined();
    await t.run(async (ctx) => {
      const other = await seedStore(ctx, "UTC");
      await ctx.db.patch("dailyClose", seeded.closeId, {
        reportSnapshot: {
          ...source.reportSnapshot!,
          closeMetadata: {
            ...source.reportSnapshot!.closeMetadata,
            storeId: other.storeId,
          },
        },
      });
    });
    expect(
      await t.run((ctx) =>
        materializeCloseEvidenceWithCtx(ctx, {
          storeId: seeded.storeId,
          closeId: seeded.closeId,
          expectedGeneration: 1,
        }),
      ),
    ).toEqual({ status: "blocked", reason: "ownership_mismatch" });
  });

  it("cleans only obsolete children and retains the current published generation", async () => {
    const { t, source, seeded } = await fixture();
    const first = await t.run((ctx) =>
      publishCloseLifecycleWithCtx(ctx, source, NOW),
    );
    await t.run((ctx) =>
      materializeCloseEvidenceWithCtx(ctx, {
        storeId: seeded.storeId,
        closeId: seeded.closeId,
        expectedGeneration: 1,
      }),
    );
    await t.run((ctx) =>
      publishCloseLifecycleWithCtx(ctx, source, NOW, { forceRepair: true }),
    );
    await t.run((ctx) =>
      materializeCloseEvidenceWithCtx(ctx, {
        storeId: seeded.storeId,
        closeId: seeded.closeId,
        expectedGeneration: 2,
      }),
    );
    expect(
      await t.run((ctx) =>
        cleanupCloseEvidenceGenerationsWithCtx(ctx, seeded.storeId, first._id),
      ),
    ).toEqual({ deleted: 1, hasMore: false });
    expect(
      (
        await t.run((ctx) =>
          readCloseEvidenceWithCtx(ctx, seeded.storeId, seeded.closeId),
        )
      ).status,
    ).toBe("ready");
  });

  it("uses only the compact accepted close after activation and refuses pending evidence", async () => {
    const { t, source, seeded } = await fixture();
    await t.run(async (ctx) => {
      await publishCloseLifecycleWithCtx(ctx, source, NOW);
      await ctx.db.insert("reportPipelineControl", {
        storeId: seeded.storeId,
        mode: "active",
        fence: 1,
        sourceWatermark: 0,
      });
    });
    await expect(
      t.run((ctx) =>
        foldAndReplaceDay(ctx, seeded.storeId, source.operatingDate, NOW, {
          deferRollups: true,
        }),
      ),
    ).rejects.toThrow("close_evidence_pending");
    await t.run((ctx) =>
      materializeCloseEvidenceWithCtx(ctx, {
        storeId: seeded.storeId,
        closeId: seeded.closeId,
        expectedGeneration: 1,
      }),
    );
    const reads = await t.run(async (ctx) => {
      const recorder = recordReadCosts(ctx);
      await foldAndReplaceDay(
        recorder.ctx,
        seeded.storeId,
        source.operatingDate,
        NOW,
        { deferRollups: true },
      );
      return recorder.snapshot();
    });
    expect(reads.byTable.dailyClose).toBeUndefined();
    const day = await t.run((ctx) => ctx.db.query("reportDay").first());
    expect(day).toMatchObject({ closeId: seeded.closeId, transactionCount: 2 });
  });

  it("keeps 1200 expense inputs and supported 1000 groups inside isolated publication budgets", async () => {
    const { t, source, seeded } = await fixture();
    const sourceSnapshot = source.reportSnapshot as Record<string, unknown>;
    const products = Array.from({ length: 1200 }, (_, index) => ({
      productSkuId: testId("productSku", `stress-sku-${index}`),
      productName: `Product ${index}`,
      productSku: `${index}`,
      quantity: 1,
      spend: 1,
    }));
    const groups = Array.from({ length: 1000 }, (_, index) => ({
      key: `group-${index}`,
      productSkuId: seeded.skuId,
      membershipCompleteness: "complete",
      oldestActionableAt: NOW,
      members: [{ createdAt: NOW, workItemId: seeded.workId }],
    }));
    const large = {
      ...source,
      reportSnapshot: {
        ...sourceSnapshot,
        expenseProductEvidence: {
          contractVersion: 1,
          status: "complete",
          expenseTotal: 1200,
          sourceItemCount: 1200,
          sourceTransactionCount: 1,
          products,
        },
        frozenSyncedSaleInventoryReviewGroups: groups,
      },
    } as Doc<"dailyClose">;
    const normalized = normalizeCloseEvidence(large);
    expect(
      normalized.items.filter((item) => item.kind === "expense"),
    ).toHaveLength(1200);
    expect(
      normalized.items.filter((item) => item.kind === "inventory"),
    ).toHaveLength(1000);
    expect(normalized.byteLength).toBeLessThan(
      CLOSE_EVIDENCE_MAX_NORMALIZED_BYTES,
    );
    expect(normalized.chunks.length).toBeLessThan(CLOSE_EVIDENCE_MAX_CHUNKS);
    await t.run(async (ctx) => {
      // Actual source bound: 200 expense products. 1,200 above is a pure
      // stress case, not a claim about the source command's supported limit.
      const actualProducts = [];
      for (let index = 0; index < 200; index += 1) {
        const productSkuId = await ctx.db.insert("productSku", {
          productId: seeded.productId,
          storeId: seeded.storeId,
          sku: `MAX-${index}`,
          images: [],
          inventoryCount: 0,
          price: 1,
          quantityAvailable: 0,
        });
        actualProducts.push({ ...products[index], productSkuId });
      }
      await ctx.db.patch("dailyClose", seeded.closeId, {
        reportSnapshot: {
          ...source.reportSnapshot!,
          expenseProductEvidence: {
            contractVersion: 1,
            status: "complete",
            expenseTotal: 200,
            sourceItemCount: 200,
            sourceTransactionCount: 1,
            products: actualProducts,
          },
          frozenSyncedSaleInventoryReviewGroups: groups as NonNullable<
            Doc<"dailyClose">["reportSnapshot"]
          >["frozenSyncedSaleInventoryReviewGroups"],
        },
      });
      await publishCloseLifecycleWithCtx(ctx, source, NOW);
    });
    expect(
      (
        await t.run((ctx) =>
          materializeCloseEvidenceWithCtx(ctx, {
            storeId: seeded.storeId,
            closeId: seeded.closeId,
            expectedGeneration: 1,
          }),
        )
      ).status,
    ).toBe("published");
  });
});
