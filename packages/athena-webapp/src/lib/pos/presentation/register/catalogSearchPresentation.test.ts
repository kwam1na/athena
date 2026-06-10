import { describe, expect, it } from "vitest";

import { mapCatalogRowToProduct } from "./catalogSearchPresentation";

describe("mapCatalogRowToProduct", () => {
  it("preserves provisional import row identity when availability is keyed by trusted SKU", () => {
    const product = mapCatalogRowToProduct(
      {
        id: "provisional-import-sku-2",
        productId: "product-1",
        productSkuId: "sku-1",
        inventoryImportProvisionalSkuId: "provisional-import-sku-2",
        availabilityPolicy: "active_provisional_import",
        name: "Imported bundle B",
        sku: "LEGACY-1",
        barcode: "123",
        price: 20,
      },
      {
        availabilityPolicy: "active_provisional_import",
        inventoryImportProvisionalSkuId: "provisional-import-sku-1" as never,
        inStock: true,
        quantityAvailable: 0,
      },
    );

    expect(product).toMatchObject({
      id: "provisional-import-sku-2",
      skuId: "sku-1",
      inventoryImportProvisionalSkuId: "provisional-import-sku-2",
      availabilityPolicy: "active_provisional_import",
      availabilityStatus: "available",
    });
  });
});
