import { Link } from "@tanstack/react-router";
import { useGetCategories } from "~/src/hooks/useGetCategories";
import { getOrigin } from "~/src/lib/navigationUtils";
import { Button } from "../ui/button";
import { PlusIcon, PackageXIcon } from "lucide-react";
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

export default function Products() {
  const categories = useGetCategories();
  const unresolvedProducts = useGetUnresolvedProducts();
  const allProducts = useGetProducts();
  const [searchValue, setSearchValue] = useState("");
  const { hasFullAdminAccess } = usePermissions();

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

  return (
    <div className="space-y-12">
      <Input
        placeholder="Search products..."
        value={searchValue}
        onChange={(event) => setSearchValue(event.target.value)}
        className="w-[320px]"
      />

      {showSearchResults ? (
        <div>
          {filteredProducts && filteredProducts.length > 0 ? (
            <GenericDataTable
              data={filteredProducts}
              columns={productColumns}
              tableId="all-products-search"
            />
          ) : (
            <div className="flex items-center justify-center min-h-[60vh] w-full">
              <EmptyState
                icon={
                  <PackageXIcon className="w-16 h-16 text-muted-foreground" />
                }
                title={
                  <div className="flex gap-1 text-sm">
                    <p className="text-muted-foreground">
                      No products match your search
                    </p>
                  </div>
                }
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex w-[50vw] flex-wrap gap-4">
            {categories?.map((category) => (
              <Link
                to={"/$orgUrlSlug/store/$storeUrlSlug/products"}
                params={(prev) => ({
                  ...prev,
                  orgUrlSlug: prev.orgUrlSlug!,
                  storeUrlSlug: prev.storeUrlSlug!,
                })}
                search={{ categorySlug: category.slug, o: getOrigin() }}
                key={category._id}
              >
                <Button variant="outline">
                  <p className="text-md">{category.name}</p>
                </Button>
              </Link>
            ))}
          </div>

          {Boolean(unresolvedProducts?.length) && (
            <div>
              <Link
                to={"/$orgUrlSlug/store/$storeUrlSlug/products/unresolved"}
                params={(prev) => ({
                  ...prev,
                  orgUrlSlug: prev.orgUrlSlug!,
                  storeUrlSlug: prev.storeUrlSlug!,
                })}
                search={{ o: getOrigin() }}
              >
                <Button
                  variant="outline"
                  className="text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100 hover:text-amber-700"
                >
                  <span>
                    <b>{unresolvedProducts?.length}</b>{" "}
                    <span className="text-xs">
                      {unresolvedProducts?.length === 1
                        ? "product"
                        : "products"}{" "}
                      missing information
                    </span>
                  </span>
                </Button>
              </Link>
            </div>
          )}

          {hasFullAdminAccess && (
            <Link
              to={"/$orgUrlSlug/store/$storeUrlSlug/products/new"}
              params={(prev) => ({
                ...prev,
                orgUrlSlug: prev.orgUrlSlug!,
                storeUrlSlug: prev.storeUrlSlug!,
              })}
              search={{ o: getOrigin() }}
              className="flex items-center gap-2"
            >
              <Button variant="ghost">
                <PlusIcon className="w-4 h-4" />
                <p className="text-md">New Product</p>
              </Button>
            </Link>
          )}
        </>
      )}
    </div>
  );
}
