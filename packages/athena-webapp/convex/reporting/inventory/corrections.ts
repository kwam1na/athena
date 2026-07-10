import { v } from "convex/values";

import { mutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireReportingStoreAccess } from "../access";
import { resolveReportingOperatingPeriodWithCtx } from "../operatingPeriods";
import { applySkuValuationCorrectionWithCtx } from "./effects";

export const correctSkuValuation = mutation({
  args: {
    inventoryCount: v.number(),
    productSkuId: v.id("productSku"),
    quantityAvailable: v.number(),
    reason: v.string(),
    requestKey: v.string(),
    storeId: v.id("store"),
    unitCostMinor: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const { athenaUser, store } = await requireReportingStoreAccess(
      ctx,
      args.storeId,
    );
    const sku = await ctx.db.get("productSku", args.productSkuId);
    if (!sku || sku.storeId !== args.storeId) {
      throw new Error("Selected SKU could not be found for this store.");
    }
    const product = await ctx.db.get("product", sku.productId);
    if (!product || product.storeId !== args.storeId) {
      throw new Error("SKU product could not be found for this store.");
    }
    const occurrenceAt = Date.now();
    const period = await resolveReportingOperatingPeriodWithCtx(ctx, {
      occurrenceAt,
      storeId: args.storeId,
    });
    return applySkuValuationCorrectionWithCtx(ctx, {
      actorUserId: athenaUser._id,
      correctedInventoryCount: args.inventoryCount,
      correctedQuantityAvailable: args.quantityAvailable,
      correctedUnitCostMinor: args.unitCostMinor,
      currencyCode: store.currency.trim().toUpperCase(),
      currencyMinorUnitScale: 2,
      occurrenceAt,
      ...(period.kind === "resolved"
        ? {
            operatingDate: period.operatingDate,
            scheduleVersionId: period.scheduleVersionId as Id<"storeSchedule">,
          }
        : {}),
      organizationId: store.organizationId,
      productSkuId: args.productSkuId,
      reason: args.reason,
      requestKey: args.requestKey,
      storeId: args.storeId,
    });
  },
});
