import type { Product } from "@/components/pos/types";
import type { RegisterCatalogSearchRow } from "@/lib/pos/presentation/register/catalogSearch";
import type { Id } from "~/convex/_generated/dataModel";

export type RegisterCatalogAvailability = {
  availabilitySource?: "live" | "local";
  availabilityPolicy?:
    | "trusted_inventory"
    | "active_provisional_import"
    | "pending_checkout";
  inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
  inStock: boolean;
  quantityAvailable: number;
};

export const POS_AVAILABILITY_NOT_READY_MESSAGE =
  "Availability not ready. Reconnect or refresh this terminal before selling this item.";

export function mapCatalogRowToProduct(
  row: RegisterCatalogSearchRow,
  availability: RegisterCatalogAvailability | undefined,
): Product {
  const quantityAvailable =
    availability && Number.isFinite(availability.quantityAvailable)
      ? Math.max(0, Math.trunc(availability.quantityAvailable))
      : undefined;
  const availabilityPolicy =
    row.availabilityPolicy ?? availability?.availabilityPolicy;
  const isProvisionalImport =
    availabilityPolicy === "active_provisional_import";
  const isPendingCheckout = availabilityPolicy === "pending_checkout";
  const availabilityStatus = isProvisionalImport
    ? "available"
    : isPendingCheckout
      ? "available"
      : quantityAvailable === undefined
        ? "unknown"
        : availability?.inStock && quantityAvailable > 0
          ? "available"
          : "out_of_stock";

  return {
    id: row.id ?? row.productSkuId,
    name: row.name,
    sku: row.sku ?? "",
    barcode: row.barcode ?? "",
    price: row.price ?? 0,
    category: row.category ?? "",
    description: row.description ?? "",
    image: row.image ?? null,
    inStock: availabilityStatus === "available",
    availabilityStatus,
    availabilityMessage: isProvisionalImport
      ? "Count pending"
      : isPendingCheckout
        ? "Review pending"
        : availabilityStatus === "unknown"
          ? POS_AVAILABILITY_NOT_READY_MESSAGE
          : undefined,
    quantityAvailable,
    size: row.size ?? "",
    length:
      typeof row.length === "number"
        ? row.length
        : row.length
          ? Number(row.length)
          : null,
    color: row.color ?? "",
    productId: row.productId as Id<"product">,
    skuId: row.productSkuId as Id<"productSku">,
    inventoryImportProvisionalSkuId: (row.inventoryImportProvisionalSkuId ??
      availability?.inventoryImportProvisionalSkuId) as
      | Id<"inventoryImportProvisionalSku">
      | undefined,
    pendingCheckoutItemId: row.pendingCheckoutItemId as
      | Id<"posPendingCheckoutItem">
      | undefined,
    pendingCheckoutAliasState: row.pendingCheckoutAliasState ?? undefined,
    availabilityPolicy,
    areProcessingFeesAbsorbed: Boolean(row.areProcessingFeesAbsorbed),
  };
}

export function normalizeExactInput(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}
