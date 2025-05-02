import { BagItem, ProductSku, SavedBagItem } from "@athena/webapp";
import { capitalizeWords } from "./utils";

/**
 * Gets the formatted product name from a product SKU
 */
export function getProductName(
  item: ProductSku | BagItem | SavedBagItem
): string {
  if (item.productCategory == "Hair") {
    if (!item.colorName)
      return capitalizeWords(item.productName || "Unavailable");

    return `${item.length}" ${item.colorName} ${capitalizeWords(item.productName || "")}`;
  }

  return capitalizeWords(item.productName || "Unavailable");
}

/**
 * Checks if a product is sold out
 */
export function isSoldOut(sku: ProductSku): boolean {
  return sku.quantityAvailable === 0;
}

/**
 * Checks if a product has low stock
 */
export function hasLowStock(sku: ProductSku): boolean {
  return (
    (sku.quantityAvailable !== undefined && sku.quantityAvailable <= 2) ||
    (sku.inventoryCount !== undefined && sku.inventoryCount <= 2)
  );
}

/**
 * Sort SKUs by length (used for default selection)
 */
export function sortSkusByLength(skus: ProductSku[]): ProductSku[] {
  return [...skus].sort((a, b) => (a.length ?? 0) - (b.length ?? 0));
}

export const sortProduct = (a: any, b: any) => {
  if (a.productCategory == "Hair" && b.productCategory == "Hair") {
    return a.length - b.length;
  }

  return a.price - b.price;
};
