import { v } from "convex/values";

import { mutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { correctSkuValuationOperationDefinition } from "../operationAdmission/domains/u5_operations_definitions";
import { admitPublicMutation } from "../platform/operationAdmission";
import { requireReportsStoreAccess } from "../reports/access";
import { resolveReportingOperatingPeriodWithCtx } from "../storeTime/operatingPeriods";
import { applySkuValuationCorrectionWithCtx } from "./effects";

/**
 * Manual SKU cost/quantity correction, driven from the product editor.
 *
 * This was `reporting/inventory/corrections.ts` before the legacy reporting
 * layer was deleted. It is inventory-ledger behavior, not reporting: it writes
 * the valuation position and the `reportingSkuValuationCorrection` audit row
 * that POS cost snapshots read from. Only the store-access gate changed, from
 * the legacy `requireReportingStoreAccess` to the rebuilt equivalent in
 * `convex/reports/access.ts`.
 */
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
  handler: admitPublicMutation(
    correctSkuValuationOperationDefinition,
    async (
      ctx,
      args: {
        inventoryCount: number;
        productSkuId: Id<"productSku">;
        quantityAvailable: number;
        reason: string;
        requestKey: string;
        storeId: Id<"store">;
        unitCostMinor: number | null;
      },
    ) => {
      const { athenaUser, store } = await requireReportsStoreAccess(
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
              scheduleVersionId:
                period.scheduleVersionId as Id<"storeSchedule">,
            }
          : {}),
        organizationId: store.organizationId,
        productSkuId: args.productSkuId,
        reason: args.reason,
        requestKey: args.requestKey,
        storeId: args.storeId,
      });
    },
  ),
});
