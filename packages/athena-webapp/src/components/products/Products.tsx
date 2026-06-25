import { Link, useSearch } from "@tanstack/react-router";
import { useGetCategories } from "~/src/hooks/useGetCategories";
import { getOrigin } from "~/src/lib/navigationUtils";
import { Button } from "../ui/button";
import { ArchiveIcon, FolderTree, PackageXIcon, PlusIcon } from "lucide-react";
import { useGetUnresolvedProducts } from "~/src/hooks/useGetProducts";
import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { GenericDataTable } from "../base/table/data-table";
import { productColumns } from "./products-table/components/productColumns";
import { EmptyState } from "../states/empty/empty-state";
import { usePermissions } from "~/src/hooks/usePermissions";
import { QuickAddProductDialog } from "../product/QuickAddProductDialog";
import type { QuickAddProductSubmitPayload } from "../product/QuickAddProductDialog";
import { normalizeQuickAddInitialLookupCode } from "../product/quickAddProductDialogUtils";
import { usePOSQuickAddProductSku } from "~/src/hooks/usePOSProducts";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { useAuth } from "~/src/hooks/useAuth";
import { toast } from "sonner";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceGrid,
  PageWorkspaceMain,
  PageWorkspaceRail,
} from "../common/PageLevelHeader";
import { Badge } from "../ui/badge";
import { cn } from "~/src/lib/utils";
import {
  matchesSkuSearchTerms,
  normalizeSkuSearchQuery,
} from "~/src/lib/stockOps/skuSearch";
import type { ProductSkuSearchResultLike } from "~/src/lib/skuSearch/productSkuSearchAdapters";
import {
  buildAdminSkuSearchOptions,
  groupAdminSkuSearchOptionsByProduct,
} from "~/src/lib/skuSearch/productSkuSearchAdapters";
import type { Product } from "~/types";
import type { Id } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { SkuSearchFilterBar } from "../stock-ops/SkuSearchFilterBar";
import type { InventorySnapshotItem } from "../operations/StockAdjustmentWorkspace";

const ALL_CATEGORY_FILTER_KEY = "all";

type ProductAvailabilityFilter = "all" | "available" | "out_of_stock";

const PRODUCT_AVAILABILITY_FILTER_OPTIONS: Array<{
  label: string;
  value: ProductAvailabilityFilter;
}> = [
  { label: "All stock", value: "all" },
  { label: "Available", value: "available" },
  { label: "Out of stock", value: "out_of_stock" },
];

export default function Products() {
  const categories = useGetCategories();
  const unresolvedProducts = useGetUnresolvedProducts();
  const [searchValue, setSearchValue] = useState("");
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickAddInitialName, setQuickAddInitialName] = useState("");
  const [quickAddInitialLookupCode, setQuickAddInitialLookupCode] =
    useState("");
  const [availabilityFilter, setAvailabilityFilter] =
    useState<ProductAvailabilityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORY_FILTER_KEY);
  const { hasFullAdminAccess } = usePermissions();
  const { activeStore } = useGetActiveStore();
  const { user } = useAuth();
  const { o } = useSearch({ strict: false });
  const quickAddProductSku = usePOSQuickAddProductSku();
  const inventoryItems = useQuery(
    api.stockOps.adjustments.listInventorySnapshot,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  ) as InventorySnapshotItem[] | undefined;
  const skuSearchResults = useQuery(
    api.inventory.skuSearch.searchProductSkus,
    activeStore?._id && searchValue.trim()
      ? { limit: 50, query: searchValue, storeId: activeStore._id }
      : "skip",
  ) as
    | {
        candidateOverflow: boolean;
        results: ProductSkuSearchResultLike[];
        truncated: boolean;
      }
    | undefined;

  const categorySlugById = useMemo(() => {
    return new Map(
      (categories ?? []).map((category) => [category._id, category.slug]),
    );
  }, [categories]);
  const products = useMemo(
    () =>
      buildProductsFromInventorySnapshot(
        inventoryItems ?? [],
        categories ?? [],
        activeStore?._id,
      ),
    [activeStore?._id, categories, inventoryItems],
  );
  const searchProducts = useMemo(
    () =>
      buildProductsFromSkuSearchResults(
        skuSearchResults?.results ?? [],
        activeStore?._id,
      ),
    [activeStore?._id, skuSearchResults?.results],
  );
  const searchProductIds = useMemo(
    () => new Set(searchProducts.map((product) => product._id)),
    [searchProducts],
  );
  const filteredProducts = useMemo(() => {
    if (!inventoryItems) return null;

    const normalizedQuery = normalizeSkuSearchQuery(searchValue);
    const sourceProducts = normalizedQuery
      ? mergeProductSearchResults(products, searchProducts)
      : products;

    return sourceProducts.filter((product) => {
      if (!productMatchesAvailabilityFilter(product, availabilityFilter)) {
        return false;
      }

      if (
        !productMatchesCategoryFilter(product, categoryFilter, categorySlugById)
      ) {
        return false;
      }

      return (
        !normalizedQuery ||
        searchProductIds.has(product._id) ||
        productMatchesCatalogSearch(product, normalizedQuery)
      );
    });
  }, [
    availabilityFilter,
    categoryFilter,
    categorySlugById,
    inventoryItems,
    products,
    searchProductIds,
    searchProducts,
    searchValue,
  ]);

  const hasSearchInput = searchValue.trim().length > 0;
  const hasActiveFilters =
    hasSearchInput ||
    availabilityFilter !== "all" ||
    categoryFilter !== ALL_CATEGORY_FILTER_KEY;
  const showSearchResults = hasActiveFilters && filteredProducts !== null;
  const unresolvedProductCount = unresolvedProducts?.length ?? 0;
  const categoryCount = categories?.length ?? 0;
  const productCount = products.length;
  const outOfStockProductCount =
    products.filter((product) => product.inventoryCount === 0).length ?? 0;
  const categoryFilterOptions = useMemo(() => {
    const productCountsByCategory = new Map<string, number>();

    for (const product of products) {
      const categoryKey = getProductCategoryFilterKey(
        product,
        categorySlugById,
      );

      if (!categoryKey) continue;

      productCountsByCategory.set(
        categoryKey,
        (productCountsByCategory.get(categoryKey) ?? 0) + 1,
      );
    }

    const optionsByKey = new Map<
      string,
      { itemCount: number; key: string; label: string }
    >();

    for (const category of categories ?? []) {
      const itemCount = productCountsByCategory.get(category.slug) ?? 0;

      if (itemCount > 0) {
        optionsByKey.set(category.slug, {
          itemCount,
          key: category.slug,
          label: category.name,
        });
      }
    }

    for (const product of products) {
      const key = getProductCategoryFilterKey(product, categorySlugById);

      if (!key || optionsByKey.has(key)) continue;

      optionsByKey.set(key, {
        itemCount: productCountsByCategory.get(key) ?? 0,
        key,
        label: product.categoryName ?? key,
      });
    }

    return [...optionsByKey.values()].sort((left, right) =>
      left.label.localeCompare(right.label),
    );
  }, [categories, categorySlugById, products]);

  const handleQuickAddSubmit = async ({
    name,
    variants,
    usesMultipleVariants,
  }: QuickAddProductSubmitPayload) => {
    if (!activeStore?._id || !user?._id) {
      throw new Error("Store sign-in is still loading. Try again in a moment.");
    }

    const [primaryVariant, ...extraVariants] = variants;
    const createdProduct = await quickAddProductSku({
      storeId: activeStore._id,
      createdByUserId: user._id,
      name,
      lookupCode: primaryVariant.lookupCode,
      price: primaryVariant.price,
      quantityAvailable: primaryVariant.quantityAvailable,
    });

    if (extraVariants.length && !createdProduct.productId) {
      throw new Error("Quick add product id missing");
    }

    for (const variant of extraVariants) {
      await quickAddProductSku({
        storeId: activeStore._id,
        createdByUserId: user._id,
        name,
        lookupCode: variant.lookupCode,
        price: variant.price,
        quantityAvailable: variant.quantityAvailable,
        productId: createdProduct.productId,
      });
    }

    toast.success(
      usesMultipleVariants ? "Product variants added" : "Product added",
    );
  };

  const handleOpenQuickAdd = () => {
    const trimmedSearchValue = searchValue.trim();
    const initialLookupCode =
      normalizeQuickAddInitialLookupCode(trimmedSearchValue);

    setQuickAddInitialName(initialLookupCode ? "" : trimmedSearchValue);
    setQuickAddInitialLookupCode(initialLookupCode);
    setIsQuickAddOpen(true);
  };

  const handleClearFilters = () => {
    setSearchValue("");
    setAvailabilityFilter("all");
    setCategoryFilter(ALL_CATEGORY_FILTER_KEY);
  };

  return (
    <PageWorkspace>
      <PageLevelHeader
        eyebrow="Catalog Ops"
        title="Products"
        description="Find catalog items, review product exceptions, and add sellable stock without leaving the products workspace."
        showBackButton={Boolean(o)}
      />

      <PageWorkspaceGrid className="xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_280px]">
        <PageWorkspaceMain>
          <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface">
            <div className="min-w-0 space-y-layout-lg px-layout-md py-layout-md">
              <SkuSearchFilterBar
                action={
                  hasFullAdminAccess ? (
                    <>
                      <Button
                        variant="ghost"
                        onClick={handleOpenQuickAdd}
                        type="button"
                      >
                        <PlusIcon className="h-4 w-4" />
                        Quick add
                      </Button>
                      <Link
                        to={"/$orgUrlSlug/store/$storeUrlSlug/products/new"}
                        params={(prev) => ({
                          ...prev,
                          orgUrlSlug: prev.orgUrlSlug!,
                          storeUrlSlug: prev.storeUrlSlug!,
                        })}
                        search={{ o: getOrigin() }}
                      >
                        <Button variant="ghost">
                          <PlusIcon className="h-4 w-4" />
                          New Product
                        </Button>
                      </Link>
                    </>
                  ) : null
                }
                ariaLabel="Product search and filters"
                className="bg-background"
                filterId="product-availability-filter"
                filterLabel="Filter by availability"
                filterOptions={PRODUCT_AVAILABILITY_FILTER_OPTIONS}
                filterValue={availabilityFilter}
                hasActiveFilters={hasActiveFilters}
                onClearFilters={handleClearFilters}
                onFilterChange={setAvailabilityFilter}
                onQueryChange={setSearchValue}
                query={searchValue}
                searchId="product-sku-search"
                searchLabel="Search products, SKUs, or barcodes"
                searchPlaceholder="Search products, SKUs, or barcode"
                secondaryFilters={
                  <div
                    aria-label="Filter by category"
                    className="flex flex-col gap-2 sm:flex-row sm:items-center"
                    role="group"
                  >
                    <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Categories
                    </span>
                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      {[
                        {
                          itemCount: products.length,
                          key: ALL_CATEGORY_FILTER_KEY,
                          label: "All categories",
                        },
                        ...categoryFilterOptions,
                      ].map((category) => {
                        const isSelected = categoryFilter === category.key;

                        return (
                          <button
                            aria-label={`${category.label}, ${category.itemCount} ${category.itemCount === 1 ? "product" : "products"}`}
                            aria-pressed={isSelected}
                            className={cn(
                              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                              isSelected
                                ? "border-action-workflow-border bg-action-workflow-soft text-foreground"
                                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                            key={category.key}
                            onClick={() =>
                              setCategoryFilter(
                                isSelected
                                  ? ALL_CATEGORY_FILTER_KEY
                                  : category.key,
                              )
                            }
                            type="button"
                          >
                            {category.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                }
                summary={
                  <>
                    Showing {filteredProducts?.length ?? products.length} of{" "}
                    {products.length}{" "}
                    {products.length === 1 ? "product" : "products"}.
                  </>
                }
              />

              {showSearchResults ? (
                <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-background">
                  <div className="flex items-center justify-between border-b border-border/70 px-layout-md py-layout-sm">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      Search results
                    </p>
                    <Badge variant="outline" size="sm">
                      {filteredProducts?.length ?? 0}
                    </Badge>
                  </div>
                  {filteredProducts && filteredProducts.length > 0 ? (
                    <GenericDataTable
                      data={filteredProducts}
                      columns={productColumns}
                      tableId="all-products-search"
                    />
                  ) : (
                    <div className="flex min-h-[18rem] items-center justify-center p-layout-md">
                      <EmptyState
                        icon={
                          <PackageXIcon className="h-12 w-12 text-muted-foreground" />
                        }
                        title={
                          <p className="text-sm text-muted-foreground">
                            No products match your search
                          </p>
                        }
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-layout-sm">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <FolderTree className="h-4 w-4 text-muted-foreground" />
                    Categories
                  </div>
                  {categories && categories.length > 0 ? (
                    <div className="flex flex-wrap gap-3">
                      {categories.map((category) => (
                        <Link
                          to={"/$orgUrlSlug/store/$storeUrlSlug/products"}
                          params={(prev) => ({
                            ...prev,
                            orgUrlSlug: prev.orgUrlSlug!,
                            storeUrlSlug: prev.storeUrlSlug!,
                          })}
                          search={{
                            categorySlug: category.slug,
                            o: getOrigin(),
                          }}
                          key={category._id}
                        >
                          <Button variant="outline" className="bg-background">
                            {category.name}
                          </Button>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-border bg-background px-layout-md py-layout-lg">
                      <p className="text-sm text-muted-foreground">
                        Categories will appear here once catalog setup begins.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </PageWorkspaceMain>

        <PageWorkspaceRail>
          <section className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
            <div className="mt-layout-md grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Products
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {productCount}
                </p>
              </div>
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Categories
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {categoryCount}
                </p>
              </div>
              <Link
                to={"/$orgUrlSlug/store/$storeUrlSlug/products/unresolved"}
                params={(prev) => ({
                  ...prev,
                  orgUrlSlug: prev.orgUrlSlug!,
                  storeUrlSlug: prev.storeUrlSlug!,
                })}
                search={{ o: getOrigin() }}
                className={cn(
                  "rounded-md border px-3 py-2 transition-colors",
                  unresolvedProductCount
                    ? "border-warning/30 bg-warning/10 hover:bg-warning/15"
                    : "border-border bg-background hover:bg-surface",
                )}
              >
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Missing info
                </p>
                <p
                  className={cn(
                    "mt-1 text-lg font-semibold tabular-nums",
                    unresolvedProductCount
                      ? "text-warning-foreground"
                      : "text-foreground",
                  )}
                >
                  {unresolvedProductCount}
                </p>
              </Link>
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Out of stock
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {outOfStockProductCount}
                </p>
              </div>
            </div>
            <div className="mt-layout-md flex flex-col gap-2 border-t border-border/70 pt-layout-md">
              <Link
                to={"/$orgUrlSlug/store/$storeUrlSlug/products/archived"}
                params={(prev) => ({
                  ...prev,
                  orgUrlSlug: prev.orgUrlSlug!,
                  storeUrlSlug: prev.storeUrlSlug!,
                })}
                search={{ o: getOrigin() }}
              >
                <Button variant="ghost" className="w-full justify-start">
                  <ArchiveIcon className="h-4 w-4" />
                  Archived products
                </Button>
              </Link>
            </div>
          </section>
        </PageWorkspaceRail>
      </PageWorkspaceGrid>

      <QuickAddProductDialog
        open={isQuickAddOpen}
        onOpenChange={setIsQuickAddOpen}
        onSubmit={handleQuickAddSubmit}
        initialName={quickAddInitialName}
        initialLookupCode={quickAddInitialLookupCode}
        skuSearchStoreId={activeStore?._id}
        description="Add a sellable product without opening the full product editor."
        submitErrorMessage="Could not quick add this product. Try again."
      />
    </PageWorkspace>
  );
}

function productMatchesCatalogSearch(product: Product, query: string) {
  return matchesSkuSearchTerms(
    [
      product.name,
      product.categoryName,
      product.subcategoryName,
      product.categorySlug,
      product.subcategorySlug,
      ...product.skus.flatMap((sku) => [
        sku.sku,
        sku.barcode,
        sku.productCategory,
        sku.productName,
        sku.colorName,
        sku.size,
        sku.length === null || sku.length === undefined
          ? undefined
          : String(sku.length),
      ]),
    ],
    query,
  );
}

function productMatchesAvailabilityFilter(
  product: Product,
  filter: ProductAvailabilityFilter,
) {
  if (filter === "available") return product.inventoryCount > 0;
  if (filter === "out_of_stock") return product.inventoryCount === 0;

  return true;
}

function productMatchesCategoryFilter(
  product: Product,
  filter: string,
  categorySlugById: Map<string, string>,
) {
  if (filter === ALL_CATEGORY_FILTER_KEY) return true;

  return getProductCategoryFilterKey(product, categorySlugById) === filter;
}

function getProductCategoryFilterKey(
  product: Product,
  categorySlugById: Map<string, string>,
) {
  return (
    product.categorySlug ??
    categorySlugById.get(product.categoryId) ??
    product.categoryName ??
    product.categoryId
  );
}

function buildProductsFromInventorySnapshot(
  inventoryItems: InventorySnapshotItem[],
  categories: Array<{ _id: Id<"category">; name: string; slug: string }>,
  storeId: Id<"store"> | undefined,
) {
  const categoryByName = new Map(
    categories.map((category) => [category.name, category]),
  );
  const productsById = new Map<Id<"product">, Product>();

  for (const item of inventoryItems) {
    const productId =
      item.productId ?? (`inventory-product-${item._id}` as Id<"product">);
    const category = item.productCategory
      ? categoryByName.get(item.productCategory)
      : undefined;
    const existingProduct = productsById.get(productId);
    const sku = {
      _id: item._id,
      _creationTime: 0,
      barcode: item.barcode ?? undefined,
      colorName: item.colorName ?? null,
      images: item.imageUrl ? [item.imageUrl] : [],
      inventoryCount: item.inventoryCount,
      length: item.length ?? undefined,
      netPrice: item.netPrice ?? undefined,
      price: item.price ?? 0,
      productCategory: item.productCategory ?? undefined,
      productId,
      productName: item.productName,
      quantityAvailable: item.quantityAvailable,
      size: item.size ?? undefined,
      sku: item.sku ?? undefined,
      storeId: storeId ?? ("" as Id<"store">),
    };

    if (existingProduct) {
      existingProduct.inventoryCount =
        (existingProduct.inventoryCount ?? 0) + item.inventoryCount;
      existingProduct.quantityAvailable =
        (existingProduct.quantityAvailable ?? 0) + item.quantityAvailable;
      existingProduct.skus.push(sku);
      continue;
    }

    productsById.set(productId, {
      _id: productId,
      _creationTime: 0,
      availability: "live",
      categoryId:
        item.productCategoryId ?? category?._id ?? ("" as Id<"category">),
      categoryName: item.productCategory ?? undefined,
      categorySlug: item.productCategorySlug ?? category?.slug,
      createdByUserId: "" as Id<"athenaUser">,
      currency: "GHS",
      inventoryCount: item.inventoryCount,
      isVisible: true,
      name: item.productName,
      organizationId: "" as Id<"organization">,
      quantityAvailable: item.quantityAvailable,
      skus: [sku],
      slug: String(productId),
      storeId: storeId ?? ("" as Id<"store">),
      subcategoryId: item.productSubcategoryId ?? ("" as Id<"subcategory">),
      subcategoryName: item.productSubcategory ?? undefined,
      subcategorySlug: item.productSubcategorySlug ?? undefined,
    });
  }

  return [...productsById.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function buildProductsFromSkuSearchResults(
  results: ProductSkuSearchResultLike[],
  storeId: Id<"store"> | undefined,
) {
  return groupAdminSkuSearchOptionsByProduct(
    buildAdminSkuSearchOptions(results),
  ).map((group) => {
    const firstOption = group.skus[0];
    const first = firstOption.searchResult;
    const skus = group.skus.map((option) => ({
      _id: option.productSkuId,
      _creationTime: first.match.rank,
      barcode: option.barcode ?? undefined,
      colorName: option.colorName,
      images: option.imageUrl ? [option.imageUrl] : [],
      inventoryCount: option.searchResult.inventoryCount,
      length: option.searchResult.length ?? undefined,
      netPrice: undefined,
      price: option.searchResult.price,
      productCategory: option.categoryName ?? undefined,
      productId: option.productId,
      productName: option.productName,
      quantityAvailable: option.quantityAvailable,
      size: option.searchResult.size ?? undefined,
      sku: option.sku ?? undefined,
      storeId: option.searchResult.storeId,
    }));

    return {
      _id: group.productId,
      _creationTime: 0,
      availability: first.productAvailability,
      categoryId: first.categoryId ?? ("" as Id<"category">),
      categoryName: first.categoryName ?? undefined,
      categorySlug: first.categorySlug ?? undefined,
      createdByUserId: "" as Id<"athenaUser">,
      currency: "GHS",
      inventoryCount: skus.reduce((total, sku) => total + sku.inventoryCount, 0),
      isVisible: first.productIsVisible ?? true,
      name: group.productName,
      organizationId: "" as Id<"organization">,
      quantityAvailable: skus.reduce(
        (total, sku) => total + sku.quantityAvailable,
        0,
      ),
      skus,
      slug: group.productSlug ?? String(group.productId),
      storeId: storeId ?? first.storeId,
      subcategoryId: first.subcategoryId ?? ("" as Id<"subcategory">),
      subcategoryName: first.subcategoryName ?? undefined,
      subcategorySlug: first.subcategorySlug ?? undefined,
    } satisfies Product;
  });
}

function mergeProductSearchResults(
  products: Product[],
  searchProducts: Product[],
) {
  if (searchProducts.length === 0) return products;

  const productsById = new Map<Product["_id"], Product>();

  for (const product of products) {
    productsById.set(product._id, product);
  }

  for (const product of searchProducts) {
    if (!productsById.has(product._id)) {
      productsById.set(product._id, product);
    }
  }

  return [...productsById.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}
