import type { Id } from "../_generated/dataModel";

export const MAX_FROZEN_LINEAGES_PER_SKU = 100;

export type FrozenInventoryImportLineage = {
  provisionalSkuId: Id<"inventoryImportProvisionalSku">;
  productSkuId?: Id<"productSku">;
  status: "active" | "finalized" | "rejected" | "closed";
  updatedAt: number;
};
