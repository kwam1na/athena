import { useMemo, useState } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { Archive, ArrowLeftIcon, CircleHelp, PackageOpen } from "lucide-react";
import { useGetArchivedProducts } from "~/src/hooks/useGetProducts";
import { useNavigateBack } from "~/src/hooks/use-navigate-back";
import { getOrigin } from "~/src/lib/navigationUtils";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { GenericDataTable } from "../base/table/data-table";
import { productColumns } from "./products-table/components/productColumns";
import { EmptyState } from "../states/empty/empty-state";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const Navigation = () => {
  const navigateBack = useNavigateBack();
  const { o } = useSearch({ strict: false });

  return (
    <div className="container mx-auto flex gap-2">
      <div className="flex items-center gap-2">
        {o && (
          <Button variant="ghost" onClick={navigateBack}>
            <ArrowLeftIcon className="w-4 h-4" />
          </Button>
        )}
        <p className="font-medium">Archived Products</p>
        <Link
          to={"/$orgUrlSlug/store/$storeUrlSlug/products"}
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
          })}
          search={{ o: getOrigin() }}
        >
          <Button variant="outline">Active products</Button>
        </Link>
      </div>
    </div>
  );
};

export const ArchivedProducts = () => {
  const products = useGetArchivedProducts();
  const [searchValue, setSearchValue] = useState("");

  const filteredProducts = useMemo(() => {
    if (!products) return null;
    if (!searchValue.trim()) return products;

    const searchLower = searchValue.toLowerCase();
    return products.filter((product) => {
      const productName = product.name.toLowerCase();
      if (productName.includes(searchLower)) {
        return true;
      }

      return product.skus.some((sku) =>
        sku.sku?.toLowerCase().includes(searchLower),
      );
    });
  }, [products, searchValue]);

  if (!products) return null;

  const hasSearchInput = searchValue.trim().length > 0;

  const EmptyStateIcon = hasSearchInput ? (
    <CircleHelp className="w-16 h-16 text-muted-foreground" />
  ) : (
    <PackageOpen className="w-16 h-16 text-muted-foreground" />
  );

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={<Navigation />}
    >
      <FadeIn className="py-8 space-y-4">
        <div className="flex items-center gap-3">
          <Archive className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by name or SKU..."
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            className="w-[320px]"
          />
        </div>
        {filteredProducts && filteredProducts.length > 0 && (
          <GenericDataTable
            data={filteredProducts}
            columns={productColumns}
            tableId="archived-products"
          />
        )}
        {filteredProducts && filteredProducts.length == 0 && (
          <div className="flex items-center justify-center min-h-[60vh] w-full">
            <EmptyState
              icon={EmptyStateIcon}
              title={
                <div className="flex gap-1 text-sm">
                  <p className="text-muted-foreground">
                    {hasSearchInput
                      ? "No archived products match your search"
                      : "No archived products"}
                  </p>
                </div>
              }
            />
          </div>
        )}
      </FadeIn>
    </View>
  );
};
