import { useSearch } from "@tanstack/react-router";
import {
  ProductsTableProvider,
  useProductsTableState,
} from "./ProductsTableContext";
import { useGetProducts } from "~/src/hooks/useGetProducts";
import type { ProductAvailability } from "~/src/hooks/useGetProducts";
import { useState, useMemo } from "react";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import StoreProducts from "./StoreProducts";
import { capitalizeWords, slugToWords } from "~/src/lib/utils";
import { AlertTriangle } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Button } from "../ui/button";
import { useAction } from "convex/react";
import { api } from "~/convex/_generated/api";
import { toast } from "sonner";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceMain,
} from "../common/PageLevelHeader";

const POS_OPERATIONAL_CATEGORY_SLUGS = new Set([
  "pos-pending-checkout",
  "pos-quick-add",
]);

export function getCategoryProductAvailability(
  categorySlug: string | undefined,
): ProductAvailability | undefined {
  return categorySlug && POS_OPERATIONAL_CATEGORY_SLUGS.has(categorySlug)
    ? "live"
    : undefined;
}

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

const CategoryWorkspaceActions = ({
  outOfStockProductsCount,
  selectedProductActions,
  setSelectedProductActions,
  hasProducts,
}: {
  outOfStockProductsCount: number;
  selectedProductActions: string[];
  setSelectedProductActions: (actions: string[]) => void;
  hasProducts: boolean;
}) => {
  const clearAllCache = useAction(api.inventory.productUtil.clearAllCache);
  const [isClearCacheMutationPending, setIsClearCacheMutationPending] =
    useState(false);

  const handleClearCache = async () => {
    setIsClearCacheMutationPending(true);
    try {
      await clearAllCache();
      toast.success("Cache cleared");
    } catch {
      toast.error("Failed to clear cache");
    } finally {
      setIsClearCacheMutationPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {outOfStockProductsCount > 0 && (
          <ProductActionsToggleGroup
            outOfStockProductsCount={outOfStockProductsCount}
            selectedProductActions={selectedProductActions}
            setSelectedProductActions={setSelectedProductActions}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {hasProducts && (
          <Button
            variant="ghost"
            onClick={handleClearCache}
            disabled={isClearCacheMutationPending}
          >
            Clear Cache
          </Button>
        )}
      </div>
    </div>
  );
};

function Body() {
  const { categorySlug, o } = useSearch({ strict: false });
  const { productsTableState } = useProductsTableState();
  const { subcategorySlug } = productsTableState;

  const products = useGetProducts({
    subcategorySlug: subcategorySlug ?? undefined,
    categorySlug: categorySlug ?? undefined,
    availability: getCategoryProductAvailability(categorySlug ?? undefined),
  });

  const [selectedProductActions, setSelectedProductActions] = useState<
    string[]
  >([]);

  const outOfStockProducts = products?.filter(
    (product) => product.inventoryCount === 0,
  );

  const filteredProducts = useMemo(() => {
    if (selectedProductActions.includes("outOfStock")) {
      return outOfStockProducts;
    }
    return products;
  }, [selectedProductActions, products, outOfStockProducts]);

  if (!filteredProducts) return null;

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Catalog Ops"
            title={capitalizeWords(slugToWords(categorySlug ?? "Products"))}
            showBackButton={Boolean(o)}
          />

          <PageWorkspaceMain>
            {categorySlug ? (
              <CategoryWorkspaceActions
                outOfStockProductsCount={outOfStockProducts?.length || 0}
                selectedProductActions={selectedProductActions}
                setSelectedProductActions={setSelectedProductActions}
                hasProducts={filteredProducts.length != 0}
              />
            ) : null}
            <StoreProducts products={filteredProducts} />
          </PageWorkspaceMain>
        </PageWorkspace>
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
