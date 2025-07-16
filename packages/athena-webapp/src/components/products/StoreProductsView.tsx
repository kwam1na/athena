import StoreProducts from "./StoreProducts";
import View from "../View";
import { useGetProducts } from "../../hooks/useGetProducts";
import {
  ProductsTableProvider,
  useProductsTableState,
} from "./ProductsTableContext";
import { FadeIn } from "../common/FadeIn";
import { useSearch } from "@tanstack/react-router";
import { slugToWords } from "~/src/lib/utils";
import { Button } from "../ui/button";
import { AlertTriangle, PackageXIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { useMemo, useState } from "react";

const ProductActionsToggleGroup = ({
  outOfStockProductsCount,
  selectedProductActions,
  setSelectedProductActions,
}: {
  outOfStockProductsCount: number;
  selectedProductActions: string[];
  setSelectedProductActions: (actions: string[]) => void;
}) => {
  return (
    <ToggleGroup
      type="multiple"
      value={selectedProductActions}
      onValueChange={setSelectedProductActions}
    >
      <ToggleGroupItem
        value="outOfStock"
        className="text-sm text-muted-foreground"
      >
        <AlertTriangle className="w-4 h-4 mr-2" />
        {outOfStockProductsCount} out of stock
      </ToggleGroupItem>
    </ToggleGroup>
  );
};

const Navigation = ({
  outOfStockProductsCount,
  selectedProductActions,
  setSelectedProductActions,
}: {
  outOfStockProductsCount: number;
  selectedProductActions: string[];
  setSelectedProductActions: (actions: string[]) => void;
}) => {
  const { categorySlug } = useSearch({ strict: false });
  return (
    <div className="container mx-auto flex gap-2">
      <div className="flex items-center gap-2">
        <p className="text-xl font-medium capitalize">
          {slugToWords(categorySlug ?? "Products")}
        </p>

        {outOfStockProductsCount > 0 && (
          <ProductActionsToggleGroup
            outOfStockProductsCount={outOfStockProductsCount}
            selectedProductActions={selectedProductActions}
            setSelectedProductActions={setSelectedProductActions}
          />
        )}
      </div>
    </div>
  );
};

function Body() {
  const { productsTableState } = useProductsTableState();
  const { categorySlug } = useSearch({ strict: false });
  const { subcategorySlug } = productsTableState;
  const products = useGetProducts({
    subcategorySlug: subcategorySlug ?? undefined,
    categorySlug: categorySlug ?? undefined,
  });

  const [selectedProductActions, setSelectedProductActions] = useState<
    string[]
  >([]);

  const hasProducts = products && products.length > 0;

  const outOfStockProducts = products?.filter(
    (product) => product.inventoryCount === 0
  );

  const filteredProducts = useMemo(() => {
    if (selectedProductActions.includes("outOfStock")) {
      return outOfStockProducts;
    }
    return products;
  }, [selectedProductActions, products]);

  if (!filteredProducts) return null;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      header={
        hasProducts && (
          <Navigation
            outOfStockProductsCount={outOfStockProducts?.length || 0}
            selectedProductActions={selectedProductActions}
            setSelectedProductActions={setSelectedProductActions}
          />
        )
      }
    >
      <FadeIn>
        <StoreProducts products={filteredProducts} />
      </FadeIn>
    </View>
  );
}

export default function StoreProductsView() {
  return (
    <ProductsTableProvider>
      <Body />
    </ProductsTableProvider>
  );
}
