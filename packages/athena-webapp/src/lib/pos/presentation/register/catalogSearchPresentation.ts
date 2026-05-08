import type { Product } from "@/components/pos/types";
import type { RegisterCatalogSearchRow } from "@/lib/pos/presentation/register/catalogSearch";
import type { Id } from "~/convex/_generated/dataModel";

export type RegisterCatalogAvailability = {
  inStock: boolean;
  quantityAvailable: number;
};

export function mapCatalogRowToProduct(
  row: RegisterCatalogSearchRow,
  availability: RegisterCatalogAvailability | undefined,
): Product {
  return {
    id: row.productSkuId,
    name: row.name,
    sku: row.sku ?? "",
    barcode: row.barcode ?? "",
    price: row.price ?? 0,
    category: row.category ?? "",
    description: row.description ?? "",
    image: row.image ?? null,
    inStock: availability?.inStock ?? false,
    quantityAvailable: availability?.quantityAvailable ?? 0,
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
    areProcessingFeesAbsorbed: Boolean(row.areProcessingFeesAbsorbed),
  };
}

export function normalizeExactInput(value: string | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}
