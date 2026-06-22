import { BagItem, ProductSku, SavedBagItem } from "@athena/webapp";
import { capitalizeWords } from "./utils";

type ProductNameInput =
  | ProductSku
  | BagItem
  | SavedBagItem
  | {
      colorName?: string | null;
      length?: number;
      productCategory?: string;
      productName?: string;
    };

/**
 * Gets the formatted product name from a product SKU
 */
export function getProductName(
  item: ProductNameInput
): string {
  if (item.productCategory == "Hair") {
    if (!item.colorName) {
      if (!item.productName) return "Unavailable";

      if (item.length) {
        return `${item.length}" ${capitalizeWords(item.productName)}`;
      }

      return capitalizeWords(item.productName);
    }

    if (item.length) {
      return `${item.length}" ${capitalizeWords(item.colorName)} ${capitalizeWords(item.productName || "")}`;
    }

    return `${capitalizeWords(item.colorName)} ${capitalizeWords(item.productName || "")}`;
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
  return sku.quantityAvailable !== undefined && sku.quantityAvailable <= 2;
}

/**
 * Sort SKUs by length (used for default selection)
 */
export function sortSkusByLength(skus: ProductSku[]): ProductSku[] {
  return [...skus].sort((a, b) => (a.length ?? 0) - (b.length ?? 0));
}

export function sortSkusByAvailabilityThenLength(
  skus: ProductSku[]
): ProductSku[] {
  return sortSkusByLength(skus).sort((a, b) => {
    const aAvailable = (a.quantityAvailable ?? 0) > 0;
    const bAvailable = (b.quantityAvailable ?? 0) > 0;

    if (aAvailable === bAvailable) {
      return 0;
    }

    return aAvailable ? -1 : 1;
  });
}

export function getPreferredSku(skus: ProductSku[]): ProductSku | undefined {
  return sortSkusByAvailabilityThenLength(skus)[0];
}

export const sortProduct = (a: any, b: any) => {
  if (a.productCategory == "Hair" && b.productCategory == "Hair") {
    return a.length - b.length;
  }

  return a.price - b.price;
};
