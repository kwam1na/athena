import { Link, useSearch } from "@tanstack/react-router";
import { useGetCategories } from "~/src/hooks/useGetCategories";
import { getOrigin } from "~/src/lib/navigationUtils";
import { Button } from "../ui/button";
import {
  ArchiveIcon,
  FolderTree,
  PackageXIcon,
  PlusIcon,
  Search,
} from "lucide-react";
import {
  useGetUnresolvedProducts,
  useGetProducts,
} from "~/src/hooks/useGetProducts";
import { useState, useMemo } from "react";
import { Input } from "../ui/input";
import { GenericDataTable } from "../base/table/data-table";
import { productColumns } from "./products-table/components/productColumns";
import { EmptyState } from "../states/empty/empty-state";
import { usePermissions } from "~/src/hooks/usePermissions";
import { QuickAddProductDialog } from "../product/QuickAddProductDialog";
import type { QuickAddProductSubmitPayload } from "../product/QuickAddProductDialog";
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

export default function Products() {
  const categories = useGetCategories();
  const unresolvedProducts = useGetUnresolvedProducts();
  const allProducts = useGetProducts();
  const [searchValue, setSearchValue] = useState("");
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const { hasFullAdminAccess } = usePermissions();
  const { activeStore } = useGetActiveStore();
  const { user } = useAuth();
  const { o } = useSearch({ strict: false });
  const quickAddProductSku = usePOSQuickAddProductSku();

  const filteredProducts = useMemo(() => {
    if (!allProducts) return null;
    if (!searchValue.trim()) return null;

    const searchLower = searchValue.toLowerCase();
    return allProducts.filter((product) => {
      // Check if product name matches
      const productName = product.name.toLowerCase();
      if (productName.includes(searchLower)) {
        return true;
      }

      // Check if any SKU matches
      return product.skus.some((sku) =>
        sku.sku?.toLowerCase().includes(searchLower),
      );
    });
  }, [allProducts, searchValue]);

  const hasSearchInput = searchValue.trim().length > 0;
  const showSearchResults = hasSearchInput && filteredProducts !== null;
  const unresolvedProductCount = unresolvedProducts?.length ?? 0;
  const categoryCount = categories?.length ?? 0;
  const productCount = allProducts?.length ?? 0;
  const outOfStockProductCount =
    allProducts?.filter((product) => product.inventoryCount === 0).length ?? 0;

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

  return (
    <PageWorkspace>
      <PageLevelHeader
        eyebrow="Catalog Ops"
        title="Products"
        description="Find catalog items, review product exceptions, and add sellable stock without leaving the products workspace."
        showBackButton={Boolean(o)}
      />

      <PageWorkspaceGrid className="xl:grid-cols-[minmax(0,1fr)_360px]">
        <PageWorkspaceMain>
          <section className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface">
            <div className="space-y-layout-lg px-layout-md py-layout-md">
              <div className="flex flex-col gap-layout-sm lg:flex-row lg:items-center lg:justify-between">
                <div className="relative max-w-xl flex-1">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    placeholder="Search products..."
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    className="pl-9"
                  />
                </div>
                {hasFullAdminAccess ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => setIsQuickAddOpen(true)}
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
                  </div>
                ) : null}
              </div>

              {showSearchResults ? (
                <div className="overflow-hidden rounded-lg border border-border bg-background">
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
            <h2 className="text-sm font-medium text-foreground">
              Product metrics
            </h2>
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
        description="Add a sellable product without opening the full product editor."
        submitErrorMessage="Could not quick add this product. Try again."
      />
    </PageWorkspace>
  );
}
