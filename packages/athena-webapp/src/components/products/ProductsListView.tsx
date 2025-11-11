import { useSearch } from "@tanstack/react-router";
import {
  ProductsTableProvider,
  useProductsTableState,
} from "./ProductsTableContext";
import { useGetProducts } from "~/src/hooks/useGetProducts";
import { useState, useMemo } from "react";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import StoreProducts from "./StoreProducts";
import { slugToWords } from "~/src/lib/utils";
import { AlertTriangle, ArrowLeftIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { useNavigateBack } from "~/src/hooks/use-navigate-back";
import { Button } from "../ui/button";

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
  categorySlug,
  outOfStockProductsCount,
  selectedProductActions,
  setSelectedProductActions,
}: {
  categorySlug: string;
  outOfStockProductsCount: number;
  selectedProductActions: string[];
  setSelectedProductActions: (actions: string[]) => void;
}) => {
  const navigateBack = useNavigateBack();
  const { o } = useSearch({ strict: false });

  return (
    <div className="container mx-auto flex gap-2">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2">
          {o && (
            <Button variant="ghost" onClick={navigateBack}>
              <ArrowLeftIcon className="w-4 h-4" />
            </Button>
          )}
          <p className="text-xl font-medium capitalize">
            {slugToWords(categorySlug)}
          </p>
        </div>

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
  const { categorySlug } = useSearch({ strict: false });
  const { productsTableState } = useProductsTableState();
  const { subcategorySlug } = productsTableState;

  const products = useGetProducts({
    subcategorySlug: subcategorySlug ?? undefined,
    categorySlug: categorySlug ?? undefined,
  });

  const [selectedProductActions, setSelectedProductActions] = useState<
    string[]
  >([]);

  const outOfStockProducts = products?.filter(
    (product) => product.inventoryCount === 0
  );

  const filteredProducts = useMemo(() => {
    if (selectedProductActions.includes("outOfStock")) {
      return outOfStockProducts;
    }
    return products;
  }, [selectedProductActions, products, outOfStockProducts]);

  if (!filteredProducts) return null;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      header={
        categorySlug && (
          <Navigation
            categorySlug={categorySlug}
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

export default function ProductsListView() {
  return (
    <ProductsTableProvider>
      <Body />
    </ProductsTableProvider>
  );
}
