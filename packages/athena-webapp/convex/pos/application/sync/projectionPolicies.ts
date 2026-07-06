import type { Id } from "../../../_generated/dataModel";
import type { PosLocalSaleItemInput } from "./types";

export type ProjectionProvisionalImportSku = {
  _id: string;
  storeId: Id<"store">;
  status: "active" | "finalized" | "rejected" | "closed";
  posExposureStatus?: "available" | "hidden";
  productId?: Id<"product">;
  productSkuId?: Id<"productSku">;
  importedBarcode?: string;
  importedPrice: number;
  finalizedAt?: number;
};

export type SaleInventoryLinePolicy = {
  source:
    | "trusted_inventory"
    | "active_provisional_import"
    | "finalized_provisional_lineage";
  stockMutationPolicy:
    | "mutate_trusted_stock"
    | "record_provisional_evidence"
    | "skip_stock_mutation";
  skipStockMutationReason?: "finalized_lineage_before_finalization";
};

export type ProvisionalImportLineageClassification =
  | {
      kind: "accepted";
      linePolicy: SaleInventoryLinePolicy;
      priceBasis: "provisional_import" | "trusted_sku";
    }
  | {
      kind: "invalid";
      reason:
        | "missing"
        | "store_mismatch"
        | "product_mismatch"
        | "sku_mismatch"
        | "inactive"
        | "hidden_active_provisional";
    };

export function saleInventoryLineKey(
  item: PosLocalSaleItemInput,
  index?: number,
) {
  return (
    item.localTransactionItemId ?? `${String(item.productSkuId)}:${index ?? 0}`
  );
}

export function classifyProvisionalImportLineage(args: {
  item: PosLocalSaleItemInput;
  provisionalImportSku: ProjectionProvisionalImportSku | null;
  saleOccurredAt: number;
  storeId: Id<"store">;
}): ProvisionalImportLineageClassification {
  const row = args.provisionalImportSku;
  if (!row) return { kind: "invalid", reason: "missing" };
  if (row.storeId !== args.storeId) {
    return { kind: "invalid", reason: "store_mismatch" };
  }
  if (row.productId !== args.item.productId) {
    return { kind: "invalid", reason: "product_mismatch" };
  }
  if (row.productSkuId !== args.item.productSkuId) {
    return { kind: "invalid", reason: "sku_mismatch" };
  }

  if (row.status === "active") {
    if (row.posExposureStatus !== "available") {
      return { kind: "invalid", reason: "hidden_active_provisional" };
    }

    return {
      kind: "accepted",
      linePolicy: {
        source: "active_provisional_import",
        stockMutationPolicy: "record_provisional_evidence",
      },
      priceBasis: "provisional_import",
    };
  }

  if (row.status === "finalized" || isFinalizationClosed(row)) {
    const mutationIsSafe =
      typeof row.finalizedAt === "number" &&
      args.saleOccurredAt >= row.finalizedAt;
    return {
      kind: "accepted",
      linePolicy: {
        source: "finalized_provisional_lineage",
        stockMutationPolicy: mutationIsSafe
          ? "mutate_trusted_stock"
          : "skip_stock_mutation",
        skipStockMutationReason: mutationIsSafe
          ? undefined
          : "finalized_lineage_before_finalization",
      },
      priceBasis: "trusted_sku",
    };
  }

  return { kind: "invalid", reason: "inactive" };
}

export function findMixedTrustedAndProvisionalSkuId(
  items: PosLocalSaleItemInput[],
  linePoliciesByLocalId: Map<string, SaleInventoryLinePolicy>,
) {
  const sourcesBySkuId = new Map<
    string,
    { hasActiveProvisionalImport: boolean; hasTrustedDemand: boolean }
  >();

  for (const [index, item] of items.entries()) {
    const skuId = String(item.productSkuId);
    const source = sourcesBySkuId.get(skuId) ?? {
      hasActiveProvisionalImport: false,
      hasTrustedDemand: false,
    };
    if (isTrustedInventorySaleItem(item, linePoliciesByLocalId, index)) {
      source.hasTrustedDemand = true;
    }
    if (
      shouldRecordProvisionalImportSaleEvidence(
        item,
        linePoliciesByLocalId,
        index,
      )
    ) {
      source.hasActiveProvisionalImport = true;
    }
    sourcesBySkuId.set(skuId, source);
  }

  for (const [skuId, source] of sourcesBySkuId.entries()) {
    if (source.hasActiveProvisionalImport && source.hasTrustedDemand) {
      return skuId;
    }
  }

  return null;
}

export function isTrustedInventorySaleItem(
  item: PosLocalSaleItemInput,
  linePoliciesByLocalId: Map<string, SaleInventoryLinePolicy>,
  index?: number,
) {
  const policy = linePoliciesByLocalId.get(saleInventoryLineKey(item, index));
  if (policy) {
    return (
      policy.source === "trusted_inventory" ||
      policy.source === "finalized_provisional_lineage"
    );
  }

  return (
    (!item.pendingCheckoutItemId ||
      item.pendingCheckoutAliasState === "linked_to_catalog") &&
    !item.inventoryImportProvisionalSkuId
  );
}

export function shouldRecordProvisionalImportSaleEvidence(
  item: PosLocalSaleItemInput,
  linePoliciesByLocalId: Map<string, SaleInventoryLinePolicy>,
  index?: number,
) {
  return (
    linePoliciesByLocalId.get(saleInventoryLineKey(item, index))?.source ===
    "active_provisional_import"
  );
}

function isFinalizationClosed(row: ProjectionProvisionalImportSku) {
  return row.status === "closed" && typeof row.finalizedAt === "number";
}
