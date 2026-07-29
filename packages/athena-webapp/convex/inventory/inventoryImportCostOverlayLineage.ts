import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const MAX_FROZEN_LINEAGES_PER_SKU = 100;

export type FrozenInventoryImportLineage = {
  provisionalSkuId: Id<"inventoryImportProvisionalSku">;
  productSkuId?: Id<"productSku">;
  status: "active" | "finalized" | "rejected" | "closed";
  updatedAt: number;
};

type LineageReadCtx = Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">;

const COST_OVERLAY_LINEAGE_STATUSES = [
  "active",
  "finalized",
  "rejected",
  "closed",
] as const;

export function canonicalizeCostOverlayLineages(
  lineages: readonly FrozenInventoryImportLineage[],
) {
  return lineages
    .map((lineage) => ({
      provisionalSkuId: lineage.provisionalSkuId,
      productSkuId: lineage.productSkuId,
      status: lineage.status,
      updatedAt: lineage.updatedAt,
    }))
    .sort((left, right) =>
      String(left.provisionalSkuId).localeCompare(
        String(right.provisionalSkuId),
      ),
    );
}

export function frozenCostOverlayLineagesMatch(
  frozen: readonly FrozenInventoryImportLineage[],
  current: readonly FrozenInventoryImportLineage[],
) {
  return (
    frozen.length <= MAX_FROZEN_LINEAGES_PER_SKU &&
    current.length <= MAX_FROZEN_LINEAGES_PER_SKU &&
    JSON.stringify(canonicalizeCostOverlayLineages(frozen)) ===
      JSON.stringify(canonicalizeCostOverlayLineages(current))
  );
}

export async function readCostOverlaySkuLineagesWithCtx(
  ctx: LineageReadCtx,
  args: {
    productSkuId: Id<"productSku">;
    storeId: Id<"store">;
  },
) {
  const records: Doc<"inventoryImportProvisionalSku">[] = [];
  for (const status of COST_OVERLAY_LINEAGE_STATUSES) {
    const remaining = MAX_FROZEN_LINEAGES_PER_SKU + 1 - records.length;
    if (remaining <= 0) break;
    const lineages = await ctx.db
      .query("inventoryImportProvisionalSku")
      .withIndex("by_storeId_productSkuId_status", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("productSkuId", args.productSkuId)
          .eq("status", status),
      )
      .take(remaining);
    records.push(...lineages);
  }
  records.sort((left, right) =>
    String(left._id).localeCompare(String(right._id)),
  );
  return {
    records,
    snapshot: canonicalizeCostOverlayLineages(
      records.map((lineage) => ({
        productSkuId: lineage.productSkuId,
        provisionalSkuId: lineage._id,
        status: lineage.status,
        updatedAt: lineage.updatedAt,
      })),
    ),
  };
}
