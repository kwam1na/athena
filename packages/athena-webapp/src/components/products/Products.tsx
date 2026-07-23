import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useGetCategories } from "~/src/hooks/useGetCategories";
import { getOrigin } from "~/src/lib/navigationUtils";
import { Button } from "../ui/button";
import { ArchiveIcon, FolderTree, PackageXIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
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
import type { ProductSkuSearchResultLike } from "~/src/lib/skuSearch/productSkuSearchAdapters";
import {
  buildAdminSkuSearchOptions,
  groupAdminSkuSearchOptionsByProduct,
} from "~/src/lib/skuSearch/productSkuSearchAdapters";
import type { Product } from "~/types";
import type { Id } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { SkuSearchFilterBar } from "../stock-ops/SkuSearchFilterBar";
import { useSharedDemoContext } from "~/src/hooks/useSharedDemoContext";

const PRODUCT_SEARCH_PAGE_SIZE = 10;

function getProductSearchPageIndex(page: number | string | undefined) {
  const pageNumber =
    typeof page === "number"
      ? page
      : typeof page === "string"
        ? Number(page)
        : 1;

  if (!Number.isFinite(pageNumber) || pageNumber < 1) {
    return 0;
  }

  return Math.floor(pageNumber) - 1;
}

function DemoNotice() {
  return <aside
    aria-label="Demo guidance"
    className="w-fit max-w-full rounded-md border border-border bg-muted/40 px-layout-md py-layout-sm"
  >
    <p className="text-sm leading-6 text-muted-foreground">
      Full catalog onboarding is not available in the demo
    </p>
  </aside>
}

export default function Products() {
  const categories = useGetCategories();
  const isSharedDemo = Boolean(useSharedDemoContext());
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickAddInitialName, setQuickAddInitialName] = useState("");
  const [quickAddInitialLookupCode, setQuickAddInitialLookupCode] =
    useState("");
  const { hasFullAdminAccess } = usePermissions();
  const { activeStore } = useGetActiveStore();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { o, page, query } = useSearch({ strict: false }) as {
    o?: string;
    page?: number;
    query?: string;
  };
  const [searchValue, setSearchValue] = useState(() => query ?? "");
  const quickAddProductSku = usePOSQuickAddProductSku();
  const repairCatalogSummary = useMutation(
    api.inventory.products.repairCatalogSummary,
  );
  const catalogSummary = useQuery(
    api.inventory.products.getCatalogSummary,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  );
  const activeSummaryRepairKey = useRef<string | null>(null);
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

  const searchProducts = useMemo(
    () =>
      buildProductsFromSkuSearchResults(
        skuSearchResults?.results ?? [],
        activeStore?._id,
      ),
    [activeStore?._id, skuSearchResults?.results],
  );
  const hasSearchInput = searchValue.trim().length > 0;
  const isSearchLoading = hasSearchInput && skuSearchResults === undefined;
  const filteredProducts = hasSearchInput ? searchProducts : null;
  const hasActiveFilters = hasSearchInput;
  const showSearchResults = hasActiveFilters;
  const searchResultCountLabel = isSearchLoading
    ? "..."
    : String(filteredProducts?.length ?? 0);
  const requestedSearchPageIndex = getProductSearchPageIndex(page);
  const searchResultPageCount = Math.max(
    1,
    Math.ceil((filteredProducts?.length ?? 0) / PRODUCT_SEARCH_PAGE_SIZE),
  );
  const searchPageIndex = Math.min(
    requestedSearchPageIndex,
    searchResultPageCount - 1,
  );
  const unresolvedProductCount = catalogSummary?.missingInfoProductCount ?? 0;
  const categoryCount = catalogSummary?.categoryCount ?? 0;
  const productCount = catalogSummary?.productCount ?? 0;
  const outOfStockProductCount = catalogSummary?.outOfStockProductCount ?? 0;
  const isCatalogSummaryPending =
    catalogSummary === undefined ||
    catalogSummary.updatedAt === 0 ||
    catalogSummary.needsRefresh === true;
  const formatCatalogMetric = (value: number) =>
    isCatalogSummaryPending ? "..." : value.toLocaleString();

  useEffect(() => {
    const nextSearchValue = query ?? "";
    setSearchValue((currentSearchValue) =>
      currentSearchValue === nextSearchValue
        ? currentSearchValue
        : nextSearchValue,
    );
  }, [query]);

  useEffect(() => {
    if (
      !showSearchResults ||
      isSearchLoading ||
      requestedSearchPageIndex === searchPageIndex
    ) {
      return;
    }

    void navigate({
      replace: true,
      search: ((current: Record<string, unknown>) => {
        const next = { ...current };
        const nextPage = searchPageIndex + 1;

        if (nextPage > 1) {
          next.page = nextPage;
        } else {
          delete next.page;
        }

        return next;
      }) as never,
    });
  }, [
    isSearchLoading,
    navigate,
    requestedSearchPageIndex,
    searchPageIndex,
    showSearchResults,
  ]);

  useEffect(() => {
    if (!activeStore?._id || catalogSummary === undefined) return;
    if (catalogSummary.updatedAt !== 0 && catalogSummary.needsRefresh !== true) {
      activeSummaryRepairKey.current = null;
      return;
    }

    const repairKey = `${activeStore._id}:${catalogSummary.updatedAt}:${catalogSummary.needsRefresh === true}`;
    if (activeSummaryRepairKey.current === repairKey) return;
    activeSummaryRepairKey.current = repairKey;

    void repairCatalogSummary({ storeId: activeStore._id }).catch(() => {
      activeSummaryRepairKey.current = null;
    });
  }, [activeStore?._id, catalogSummary, repairCatalogSummary]);

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

  const handleQueryChange = (nextSearchValue: string) => {
    setSearchValue(nextSearchValue);

    void navigate({
      replace: true,
      search: ((current: Record<string, unknown>) => {
        const next = { ...current };

        if (nextSearchValue.trim()) {
          next.query = nextSearchValue;
        } else {
          delete next.query;
        }
        delete next.page;

        return next;
      }) as never,
    });
  };

  const handleClearFilters = () => {
    handleQueryChange("");
  };

  const handleSearchPageIndexChange = (nextPageIndex: number) => {
    void navigate({
      replace: true,
      search: ((current: Record<string, unknown>) => {
        const next = { ...current };
        const nextPage = nextPageIndex + 1;

        if (nextPage > 1) {
          next.page = nextPage;
        } else {
          delete next.page;
        }

        return next;
      }) as never,
    });
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
          <section className="min-w-0 space-y-layout-lg">
            {isSharedDemo && <DemoNotice />}
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
                    {!isSharedDemo ? (
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
                    ) : null}
                  </>
                ) : null
              }
              ariaLabel="Product search and filters"
              hasActiveFilters={hasActiveFilters}
              onClearFilters={handleClearFilters}
              onQueryChange={handleQueryChange}
              query={searchValue}
              searchId="product-sku-search"
              searchLabel="Search products, SKUs, or barcodes"
              searchPlaceholder="Search products, SKUs, or barcode"
              variant="plain"
            />

            {showSearchResults ? (
              <div className="min-w-0 pt-layout-xl">
                <div className="flex items-center justify-between px-layout-md pb-layout-sm">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Search results
                  </p>
                  <Badge variant="outline" size="sm">
                    {searchResultCountLabel}
                  </Badge>
                </div>
                {isSearchLoading ? (
                  <div
                    aria-live="polite"
                    className="flex min-h-[18rem] items-center justify-center p-layout-md"
                    role="status"
                  >
                    <EmptyState
                      icon={
                        <PackageXIcon className="h-12 w-12 text-muted-foreground" />
                      }
                      title={
                        <p className="text-sm text-muted-foreground">
                          Searching product catalog
                        </p>
                      }
                      description="Checking matching products before showing final results."
                    />
                  </div>
                ) : filteredProducts && filteredProducts.length > 0 ? (
                  <GenericDataTable
                    data={filteredProducts}
                    columns={productColumns}
                    pageIndex={searchPageIndex}
                    onPageIndexChange={handleSearchPageIndexChange}
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
              <div className="space-y-layout-sm pt-layout-xl">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <FolderTree className="h-4 w-4 text-muted-foreground" />
                  Browse categories
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
                  {formatCatalogMetric(productCount)}
                </p>
              </div>
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Categories
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {formatCatalogMetric(categoryCount)}
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
                    !isCatalogSummaryPending && unresolvedProductCount
                      ? "text-warning-foreground"
                      : "text-foreground",
                  )}
                >
                  {formatCatalogMetric(unresolvedProductCount)}
                </p>
              </Link>
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Out of stock
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {formatCatalogMetric(outOfStockProductCount)}
                </p>
              </div>
            </div>
            {!isSharedDemo ? (
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
            ) : null}
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
      inventoryCount: skus.reduce(
        (total, sku) => total + sku.inventoryCount,
        0,
      ),
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
