/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import schema from "../schema";
import {
  advanceSkuAttributionAppliedWithCtx,
  allocateSkuAttributionSequenceWithCtx,
  markSkuAttributionAppliedWithCtx,
  SKU_ATTRIBUTION_APPLIED_ADVANCE_LIMIT,
  unresolvedSkuAttributionConflictAtOrBeforeWithCtx,
} from "./skuAttributionSequence";

const modules = import.meta.glob("../**/*.ts");

describe("reporting SKU attribution sequence", () => {
  it("orders same-millisecond mutations and coalesces stale apply", async () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", {
        email: "admin@example.test",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: userId,
        name: "Org",
        slug: "org",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: userId,
        currency: "GHS",
        name: "Store",
        organizationId,
        slug: "store",
      });
      const first = await allocateSkuAttributionSequenceWithCtx(ctx, storeId);
      const second = await allocateSkuAttributionSequenceWithCtx(ctx, storeId);
      expect([first, second]).toEqual([1, 2]);
      await expect(
        markSkuAttributionAppliedWithCtx(ctx, {
          sequence: second,
          storeId,
        }),
      ).resolves.toEqual({
        advancedTo: undefined,
        caughtUp: false,
        needsContinuation: false,
      });
      await expect(
        markSkuAttributionAppliedWithCtx(ctx, {
          sequence: first,
          storeId,
        }),
      ).resolves.toEqual({
        advancedTo: 2,
        caughtUp: true,
        needsContinuation: false,
      });
    });
    vi.restoreAllMocks();
  });

  it("bounds contiguous advancement and resumes a long receipt backlog", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", {
        email: "admin@example.test",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: userId,
        name: "Org",
        slug: "org",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: userId,
        currency: "GHS",
        name: "Store",
        organizationId,
        slug: "store",
      });
      const terminal = SKU_ATTRIBUTION_APPLIED_ADVANCE_LIMIT + 5;
      for (let sequence = 1; sequence <= terminal; sequence += 1) {
        await allocateSkuAttributionSequenceWithCtx(ctx, storeId);
      }
      for (let sequence = 2; sequence <= terminal; sequence += 1) {
        await ctx.db.insert("reportingSkuAttributionAppliedSequence", {
          completedAt: sequence,
          sequence,
          storeId,
        });
      }

      await expect(
        markSkuAttributionAppliedWithCtx(ctx, { sequence: 1, storeId }),
      ).resolves.toEqual({
        advancedTo: SKU_ATTRIBUTION_APPLIED_ADVANCE_LIMIT,
        caughtUp: false,
        needsContinuation: true,
      });
      await expect(
        advanceSkuAttributionAppliedWithCtx(ctx, storeId),
      ).resolves.toEqual({
        advancedTo: terminal,
        caughtUp: true,
        needsContinuation: false,
      });
      await expect(
        ctx.db
          .query("reportingSkuAttributionCursor")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      ).resolves.toMatchObject({ latestAppliedSequence: terminal });
    });
  });

  it("finds only unresolved conflicts at or before the candidate terminal", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", {
        email: "admin@example.test",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: userId,
        name: "Org",
        slug: "org-conflict",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: userId,
        currency: "GHS",
        name: "Store",
        organizationId,
        slug: "store-conflict",
      });
      const pendingCheckoutItemId = await ctx.db.insert(
        "posPendingCheckoutItem",
        {
          createdAt: 1,
          createdFrom: "online",
          currency: "GHS",
          evidence: {
            firstSeenAt: 1,
            lastSeenAt: 1,
            observedLookupCodes: [],
            observedPrices: [100],
            totalQuantitySold: 1,
            transactionCount: 1,
          },
          name: "Pending",
          normalizedName: "pending",
          organizationId,
          provisionalPrice: 100,
          reviewPriority: "normal",
          status: "pending_review",
          storeId,
          updatedAt: 1,
        },
      );
      const categoryId = await ctx.db.insert("category", {
        name: "Category",
        slug: "category",
        storeId,
      });
      const subcategoryId = await ctx.db.insert("subcategory", {
        categoryId,
        name: "Subcategory",
        slug: "subcategory",
        storeId,
      });
      const productId = await ctx.db.insert("product", {
        availability: "live",
        categoryId,
        createdByUserId: userId,
        currency: "GHS",
        inventoryCount: 0,
        name: "Product",
        organizationId,
        slug: "product",
        storeId,
        subcategoryId,
      });
      const skuId = await ctx.db.insert("productSku", {
        attributes: {},
        images: [],
        inventoryCount: 0,
        price: 100,
        productId,
        quantityAvailable: 0,
        sku: "SKU-CONFLICT",
        storeId,
      });
      const attributionId = await ctx.db.insert("reportingSkuAttribution", {
        attemptCount: 1,
        attributionKind: "pending_checkout",
        attributionVersion: 1,
        canonicalProductSkuId: skuId,
        createdAt: 1,
        materialSequence: 2,
        organizationId,
        originalProductSkuId: skuId,
        pendingCheckoutItemId,
        recoveryDisposition: "recovered",
        status: "conflict",
        storeId,
        updatedAt: 1,
      });
      await expect(
        unresolvedSkuAttributionConflictAtOrBeforeWithCtx(ctx, {
          storeId,
          terminalSequence: 1,
        }),
      ).resolves.toBeNull();
      await expect(
        unresolvedSkuAttributionConflictAtOrBeforeWithCtx(ctx, {
          storeId,
          terminalSequence: 2,
        }),
      ).resolves.toMatchObject({ _id: attributionId });
      await ctx.db.patch("reportingSkuAttribution", attributionId, {
        status: "pending",
      });
      await expect(
        unresolvedSkuAttributionConflictAtOrBeforeWithCtx(ctx, {
          storeId,
          terminalSequence: 2,
        }),
      ).resolves.toBeNull();
    });
  });
});
