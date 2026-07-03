import { useMemo, useState } from "react";
import { Archive, CircleHelp, PackageOpen } from "lucide-react";
import { useGetArchivedProducts } from "~/src/hooks/useGetProducts";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { GenericDataTable } from "../base/table/data-table";
import { productColumns } from "./products-table/components/productColumns";
import { EmptyState } from "../states/empty/empty-state";
import { Input } from "../ui/input";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceMain,
} from "../common/PageLevelHeader";

const ArchivedProductsToolbar = ({
  searchValue,
  onSearchValueChange,
}: {
  searchValue: string;
  onSearchValueChange: (value: string) => void;
}) => {
  return (
    <section
      aria-label="Archived product controls"
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Archive className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          aria-label="Filter archived products"
          placeholder="Filter by name or SKU..."
          value={searchValue}
          onChange={(event) => onSearchValueChange(event.target.value)}
          className="w-full sm:w-[320px]"
        />
      </div>
    </section>
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
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Catalog Ops"
            title="Archived Products"
            showBackButton
          />

          <PageWorkspaceMain>
            <ArchivedProductsToolbar
              searchValue={searchValue}
              onSearchValueChange={setSearchValue}
            />

            {filteredProducts && filteredProducts.length > 0 && (
              <GenericDataTable
                data={filteredProducts}
                columns={productColumns}
                tableId="archived-products"
              />
            )}
            {filteredProducts && filteredProducts.length == 0 && (
              <div className="flex min-h-[60vh] w-full items-center justify-center">
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
          </PageWorkspaceMain>
        </PageWorkspace>
      </FadeIn>
    </View>
  );
};
