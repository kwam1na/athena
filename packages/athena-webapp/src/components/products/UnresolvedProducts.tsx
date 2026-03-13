import { useGetUnresolvedProducts } from "~/src/hooks/useGetProducts";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { GenericDataTable } from "../base/table/data-table";
import { productColumns } from "./products-table/components/productColumns";
import {
  ArrowLeftIcon,
  CircleCheck,
  CircleQuestionMark,
  FileQuestionMark,
} from "lucide-react";
import { EmptyState } from "../states/empty/empty-state";
import { Button } from "../ui/button";
import { useNavigateBack } from "~/src/hooks/use-navigate-back";
import { useSearch } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Input } from "../ui/input";
import { QuestionMarkIcon } from "@radix-ui/react-icons";

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
        <p className="font-medium">Unresolved Products</p>
      </div>
    </div>
  );
};

export const UnresolvedProducts = () => {
  const products = useGetUnresolvedProducts();
  const [searchValue, setSearchValue] = useState("");

  const filteredProducts = useMemo(() => {
    if (!products) return null;
    if (!searchValue.trim()) return products;

    const searchLower = searchValue.toLowerCase();
    return products.filter((product) => {
      // Check if product name matches
      const productName = product.name.toLowerCase();
      if (productName.includes(searchLower)) {
        return true;
      }

      // Check if any SKU matches
      return product.skus.some((sku) =>
        sku.sku?.toLowerCase().includes(searchLower)
      );
    });
  }, [products, searchValue]);

  if (!products) return null;

  const hasSearchInput = searchValue.trim().length > 0;

  const EmptyStateIcon = hasSearchInput ? (
    <CircleQuestionMark className="w-16 h-16 text-muted-foreground" />
  ) : (
    <CircleCheck className="w-16 h-16 text-muted-foreground" />
  );

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={<Navigation />}
    >
      <FadeIn className="py-8 space-y-4">
        <Input
          placeholder="Filter by name or SKU..."
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          className="w-[320px]"
        />
        {filteredProducts && filteredProducts.length > 0 && (
          <GenericDataTable
            data={filteredProducts}
            columns={productColumns}
            tableId="unresolved-products"
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
                      ? "No products match your search"
                      : "You have no products pending review"}
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
