import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../_generated/dataModel";

const mocks = vi.hoisted(() => ({
  findActivePendingCheckoutLookupAliasByCode: vi.fn(),
  findActiveProvisionalImportSkuForStoreSku: vi.fn(),
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
  findActivePendingCheckoutLookupAliasByCode:
    mocks.findActivePendingCheckoutLookupAliasByCode,
  findActiveProvisionalImportSkuForStoreSku:
    mocks.findActiveProvisionalImportSkuForStoreSku,
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

const ctx = {
  db: {
    get: async (table: string, id: string) =>
      table === "productSku" ? skuById[id as keyof typeof skuById] ?? null : null,
  },
} as never;
const storeId = "store-1" as Id<"store">;

describe("searchCatalog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getCategoryById.mockImplementation(
      async (_ctx, categoryId) =>
        categoryById[categoryId as keyof typeof categoryById] ?? null,
    );
    mocks.getColorById.mockResolvedValue({ name: "Black" });
    mocks.isConvexProductId.mockReturnValue(false);
    mocks.findStoreSkuByBarcode.mockResolvedValue(null);
    mocks.findStoreSkuBySku.mockResolvedValue(null);
    mocks.findActivePendingCheckoutLookupAliasByCode.mockResolvedValue(null);
    mocks.findActiveProvisionalImportSkuForStoreSku.mockResolvedValue(null);
    mocks.getProductById.mockImplementation(
      async (_ctx, productId) =>
        productById[productId as keyof typeof productById] ?? null,
    );
  });

  it("excludes draft products, hidden products, and hidden SKUs from text search", async () => {
    mocks.findActiveProvisionalImportSkuForStoreSku.mockImplementation(
      async (_ctx, args) =>
        args.productSkuId === "sku-active-legacy-import"
          ? { _id: "provisional-active" }
          : null,
    );
    mocks.listMatchingStoreSkus.mockResolvedValue([
      { product: productById["product-live"], sku: skuById["sku-live"] },
      { product: productById["product-draft"], sku: skuById["sku-draft"] },
      {
        product: productById["product-hidden"],
        sku: skuById["sku-hidden-product"],
      },
      {
        product: productById["product-pos-quick-add"],
        sku: skuById["sku-pos-quick-add"],
      },
      {
        product: productById["product-pos-pending-checkout"],
        sku: skuById["sku-pos-pending-checkout"],
      },
      {
        product: productById["product-finalized-legacy-import"],
        sku: skuById["sku-finalized-legacy-import"],
      },
      {
        product: productById["product-active-legacy-import"],
        sku: skuById["sku-active-legacy-import"],
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
      expect.objectContaining({
        id: "sku-pos-quick-add",
        productId: "product-pos-quick-add",
        skuId: "sku-pos-quick-add",
      }),
      expect.objectContaining({
        id: "sku-pos-pending-checkout",
        productId: "product-pos-pending-checkout",
        skuId: "sku-pos-pending-checkout",
      }),
      expect.objectContaining({
        id: "sku-finalized-legacy-import",
        productId: "product-finalized-legacy-import",
        skuId: "sku-finalized-legacy-import",
        price: 4000,
      }),
    ]);
    expect(
      mocks.findActiveProvisionalImportSkuForStoreSku,
    ).toHaveBeenCalledWith(ctx, {
      storeId,
      productSkuId: "sku-active-legacy-import",
    });
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

  it("includes hidden live products from the reserved POS quick-add category", async () => {
    mocks.findStoreSkuByBarcode.mockResolvedValueOnce(
      skuById["sku-pos-quick-add"],
    );

    await expect(
      lookupByBarcode(ctx, { storeId, barcode: "777" }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "sku-pos-quick-add",
        category: "POS quick add",
        productId: "product-pos-quick-add",
      }),
    );
  });

  it("includes hidden live products from the reserved POS pending-checkout category", async () => {
    mocks.findStoreSkuByBarcode.mockResolvedValueOnce(
      skuById["sku-pos-pending-checkout"],
    );

    await expect(
      lookupByBarcode(ctx, { storeId, barcode: "888" }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "sku-pos-pending-checkout",
        category: "POS pending checkout",
        productId: "product-pos-pending-checkout",
      }),
    );
  });

  it("includes finalized legacy-import rows in exact lookup after the provisional row closes", async () => {
    mocks.findStoreSkuBySku.mockResolvedValueOnce(
      skuById["sku-finalized-legacy-import"],
    );

    await expect(
      lookupByBarcode(ctx, { storeId, barcode: "FINAL-LEGACY" }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "sku-finalized-legacy-import",
        category: "Legacy import",
        productId: "product-finalized-legacy-import",
        price: 4000,
      }),
    );
  });

  it("resolves a linked pending checkout lookup alias to the trusted SKU", async () => {
    mocks.findActivePendingCheckoutLookupAliasByCode.mockResolvedValueOnce({
      pendingCheckoutItemId: "pending-1",
      productSkuId: "sku-live",
    });

    await expect(
      lookupByBarcode(ctx, { storeId, barcode: "999888777666" }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "sku-live",
        pendingCheckoutAliasState: "linked_to_catalog",
        pendingCheckoutItemId: "pending-1",
        productId: "product-live",
        skuId: "sku-live",
      }),
    );
    expect(
      mocks.findActivePendingCheckoutLookupAliasByCode,
    ).toHaveBeenCalledWith(ctx, {
      storeId,
      lookupCode: "999888777666",
    });
  });

  it("includes a linked pending checkout lookup alias in text search results", async () => {
    mocks.listMatchingStoreSkus.mockResolvedValue([]);
    mocks.findActivePendingCheckoutLookupAliasByCode.mockResolvedValueOnce({
      pendingCheckoutItemId: "pending-1",
      productSkuId: "sku-live",
    });

    await expect(
      searchProducts(ctx, { storeId, searchQuery: "999888777666" }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "sku-live",
        pendingCheckoutAliasState: "linked_to_catalog",
        pendingCheckoutItemId: "pending-1",
        productId: "product-live",
        skuId: "sku-live",
      }),
    ]);
  });

  it("keeps active legacy-import trusted rows suppressed until provisional finalization closes", async () => {
    mocks.findStoreSkuBySku.mockResolvedValueOnce(
      skuById["sku-active-legacy-import"],
    );
    mocks.findActiveProvisionalImportSkuForStoreSku.mockResolvedValueOnce({
      _id: "provisional-active",
    });

    await expect(
      lookupByBarcode(ctx, { storeId, barcode: "ACTIVE-LEGACY" }),
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
  "product-pos-quick-add": {
    _id: "product-pos-quick-add",
    storeId,
    categoryId: "category-pos-quick-add",
    name: "Quick Added Item",
    description: "",
    availability: "live",
    isVisible: false,
  },
  "product-pos-pending-checkout": {
    _id: "product-pos-pending-checkout",
    storeId,
    categoryId: "category-pos-pending-checkout",
    name: "Pending Checkout Item",
    description: "",
    availability: "draft",
    isVisible: false,
  },
  "product-finalized-legacy-import": {
    _id: "product-finalized-legacy-import",
    storeId,
    categoryId: "category-legacy-import",
    name: "Finalized Legacy Import",
    description: "",
    availability: "draft",
    isVisible: false,
  },
  "product-active-legacy-import": {
    _id: "product-active-legacy-import",
    storeId,
    categoryId: "category-legacy-import",
    name: "Active Legacy Import",
    description: "",
    availability: "draft",
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

const categoryById = {
  "category-1": {
    _id: "category-1",
    name: "Retail",
    slug: "retail",
  },
  "category-pos-quick-add": {
    _id: "category-pos-quick-add",
    name: "POS quick add",
    slug: "pos-quick-add",
  },
  "category-pos-pending-checkout": {
    _id: "category-pos-pending-checkout",
    name: "POS pending checkout",
    slug: "pos-pending-checkout",
  },
  "category-legacy-import": {
    _id: "category-legacy-import",
    name: "Legacy import",
    slug: "legacy-import",
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
  "sku-pos-quick-add": {
    _id: "sku-pos-quick-add",
    storeId,
    productId: "product-pos-quick-add",
    sku: "QUICK-ADD",
    barcode: "777",
    images: [],
    netPrice: 1000,
    price: 1000,
    quantityAvailable: 1,
  },
  "sku-pos-pending-checkout": {
    _id: "sku-pos-pending-checkout",
    storeId,
    productId: "product-pos-pending-checkout",
    sku: "PENDING-CHECKOUT",
    barcode: "888",
    images: [],
    isVisible: false,
    netPrice: 1000,
    price: 1000,
    quantityAvailable: 0,
  },
  "sku-finalized-legacy-import": {
    _id: "sku-finalized-legacy-import",
    storeId,
    productId: "product-finalized-legacy-import",
    sku: "FINAL-LEGACY",
    barcode: "",
    images: [],
    isVisible: true,
    price: 4000,
    quantityAvailable: 20,
  },
  "sku-active-legacy-import": {
    _id: "sku-active-legacy-import",
    storeId,
    productId: "product-active-legacy-import",
    sku: "ACTIVE-LEGACY",
    barcode: "",
    images: [],
    isVisible: true,
    price: 4000,
    quantityAvailable: 20,
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
