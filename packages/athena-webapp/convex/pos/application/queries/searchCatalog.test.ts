import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../_generated/dataModel";

const mocks = vi.hoisted(() => ({
  findStoreSkuByBarcode: vi.fn(),
  findStoreSkuBySku: vi.fn(),
  getCategoryById: vi.fn(),
  getColorById: vi.fn(),
  getProductById: vi.fn(),
  isConvexProductId: vi.fn(),
  listMatchingStoreSkus: vi.fn(),
  listProductSkusByProductId: vi.fn(),
}));

vi.mock("../../infrastructure/repositories/catalogRepository", () => ({
  findStoreSkuByBarcode: mocks.findStoreSkuByBarcode,
  findStoreSkuBySku: mocks.findStoreSkuBySku,
  getCategoryById: mocks.getCategoryById,
  getColorById: mocks.getColorById,
  getProductById: mocks.getProductById,
  isConvexProductId: mocks.isConvexProductId,
  listMatchingStoreSkus: mocks.listMatchingStoreSkus,
  listProductSkusByProductId: mocks.listProductSkusByProductId,
}));

import { lookupByBarcode, searchProducts } from "./searchCatalog";

const ctx = {} as never;
const storeId = "store-1" as Id<"store">;

describe("searchCatalog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getCategoryById.mockResolvedValue({ name: "Retail" });
    mocks.getColorById.mockResolvedValue({ name: "Black" });
    mocks.isConvexProductId.mockReturnValue(false);
    mocks.findStoreSkuByBarcode.mockResolvedValue(null);
    mocks.findStoreSkuBySku.mockResolvedValue(null);
    mocks.getProductById.mockImplementation(async (_ctx, productId) =>
      productById[productId as keyof typeof productById] ?? null,
    );
  });

  it("excludes draft products, hidden products, and hidden SKUs from text search", async () => {
    mocks.listMatchingStoreSkus.mockResolvedValue([
      { product: productById["product-live"], sku: skuById["sku-live"] },
      { product: productById["product-draft"], sku: skuById["sku-draft"] },
      {
        product: productById["product-hidden"],
        sku: skuById["sku-hidden-product"],
      },
      {
        product: productById["product-hidden-sku"],
        sku: skuById["sku-hidden"],
      },
    ]);

    await expect(
      searchProducts(ctx, { storeId, searchQuery: "wig" }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "sku-live",
        productId: "product-live",
        skuId: "sku-live",
      }),
    ]);
  });

  it("excludes hidden and draft rows from barcode and SKU lookup", async () => {
    mocks.findStoreSkuByBarcode.mockResolvedValueOnce(skuById["sku-hidden"]);

    await expect(
      lookupByBarcode(ctx, { storeId, barcode: "444" }),
    ).resolves.toBeNull();

    mocks.findStoreSkuByBarcode.mockResolvedValueOnce(skuById["sku-draft"]);
    await expect(
      lookupByBarcode(ctx, { storeId, barcode: "666" }),
    ).resolves.toBeNull();
  });

  it("excludes hidden SKUs from exact product-id lookup", async () => {
    mocks.isConvexProductId.mockReturnValue(true);
    mocks.listProductSkusByProductId.mockResolvedValue([
      skuById["sku-live"],
      skuById["sku-hidden"],
    ]);

    await expect(
      searchProducts(ctx, {
        storeId,
        searchQuery: "product-live",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "sku-live",
      }),
    ]);
  });
});

const productById = {
  "product-live": {
    _id: "product-live",
    storeId,
    categoryId: "category-1",
    name: "Body Wave",
    description: "",
    availability: "live",
  },
  "product-draft": {
    _id: "product-draft",
    storeId,
    categoryId: "category-1",
    name: "Draft Anchor",
    description: "",
    availability: "draft",
    isVisible: false,
  },
  "product-hidden": {
    _id: "product-hidden",
    storeId,
    categoryId: "category-1",
    name: "Hidden Product",
    description: "",
    isVisible: false,
  },
  "product-hidden-sku": {
    _id: "product-hidden-sku",
    storeId,
    categoryId: "category-1",
    name: "Hidden SKU Product",
    description: "",
  },
};

const skuById = {
  "sku-live": {
    _id: "sku-live",
    storeId,
    productId: "product-live",
    sku: "BW-1",
    barcode: "123",
    images: [],
    netPrice: 1000,
    price: 1000,
    quantityAvailable: 3,
  },
  "sku-draft": {
    _id: "sku-draft",
    storeId,
    productId: "product-draft",
    sku: "PENDING-1",
    barcode: "666",
    images: [],
    price: 1000,
    quantityAvailable: 1,
    isVisible: false,
  },
  "sku-hidden-product": {
    _id: "sku-hidden-product",
    storeId,
    productId: "product-hidden",
    sku: "HIDDEN-PRODUCT",
    barcode: "555",
    images: [],
    price: 1000,
    quantityAvailable: 1,
  },
  "sku-hidden": {
    _id: "sku-hidden",
    storeId,
    productId: "product-hidden-sku",
    sku: "HIDDEN-SKU",
    barcode: "444",
    images: [],
    price: 1000,
    quantityAvailable: 1,
    isVisible: false,
  },
};
