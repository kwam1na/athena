import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ProductsTableProvider,
  useProductsTableState,
} from "./ProductsTableContext";
import { useGetProducts } from "~/src/hooks/useGetProducts";
import { useEffect, useMemo, useState } from "react";
import { useGetCategories } from "~/src/hooks/useGetCategories";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import StoreProducts from "./StoreProducts";
import { capitalizeWords, slugToWords } from "~/src/lib/utils";
import { AlertTriangle, Eye, EyeOff } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { useAction, useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { toast } from "sonner";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceMain,
} from "../common/PageLevelHeader";
import {
  CATEGORY_PRODUCT_PAGE_SIZE,
  getCategoryProductPageIndex,
  getCategoryProductQueryOptions,
  writeCategoryProductPageSearch,
} from "./ProductsListView.logic";

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
  categorySlug,
  outOfStockProductsCount,
  selectedProductActions,
  setSelectedProductActions,
  hasProducts,
}: {
  categorySlug: string;
  outOfStockProductsCount: number;
  selectedProductActions: string[];
  setSelectedProductActions: (actions: string[]) => void;
  hasProducts: boolean;
}) => {
  const categories = useGetCategories();
  const updateCategory = useMutation(api.inventory.categories.update);
  const clearAllCache = useAction(api.inventory.productUtil.clearAllCache);
  const category = categories?.find(({ slug }) => slug === categorySlug);
  const [isClearCacheMutationPending, setIsClearCacheMutationPending] =
    useState(false);
  const [
    isStorefrontVisibilityMutationPending,
    setIsStorefrontVisibilityMutationPending,
  ] = useState(false);

  const isStorefrontVisible = category?.showOnStorefront !== false;

  const handleStorefrontVisibilityChange = async (checked: boolean) => {
    if (!category) return;

    setIsStorefrontVisibilityMutationPending(true);
    try {
      await updateCategory({
        id: category._id,
        name: category.name,
        slug: category.slug,
        showOnStorefront: checked,
      });
      toast.success(
        `${category.name} ${checked ? "shown on" : "hidden from"} storefront`,
      );
    } catch {
      toast.error("Failed to update category visibility");
    } finally {
      setIsStorefrontVisibilityMutationPending(false);
    }
  };

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
    <section aria-label="Category controls" className="flex justify-end">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {category ? (
          <div className="flex min-h-9 items-center gap-2 rounded-md border px-3">
            {isStorefrontVisible ? (
              <Eye className="h-4 w-4 text-muted-foreground" />
            ) : (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm text-muted-foreground">Storefront</span>
            <Switch
              aria-label="Show category on storefront"
              checked={isStorefrontVisible}
              disabled={isStorefrontVisibilityMutationPending}
              onCheckedChange={handleStorefrontVisibilityChange}
            />
          </div>
        ) : null}

        {outOfStockProductsCount > 0 && (
          <ProductActionsToggleGroup
            outOfStockProductsCount={outOfStockProductsCount}
            selectedProductActions={selectedProductActions}
            setSelectedProductActions={setSelectedProductActions}
          />
        )}

        {hasProducts && (
          <Button
            variant="ghost"
            onClick={handleClearCache}
            disabled={isClearCacheMutationPending}
          >
            Clear cache
          </Button>
        )}
      </div>
    </section>
  );
};

function Body() {
  const navigate = useNavigate();
  const { categorySlug, o, page } = useSearch({ strict: false }) as {
    categorySlug?: string;
    o?: string;
    page?: number | string;
  };
  const { productsTableState } = useProductsTableState();
  const { subcategorySlug } = productsTableState;
  const categoryProductQueryOptions = getCategoryProductQueryOptions(
    categorySlug ?? undefined,
  );

  const products = useGetProducts({
    subcategorySlug: subcategorySlug ?? undefined,
    categorySlug: categorySlug ?? undefined,
    ...categoryProductQueryOptions,
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

  const isLoadingProducts = filteredProducts === undefined;
  const requestedPageIndex = getCategoryProductPageIndex(page);
  const pageCount = Math.max(
    1,
    Math.ceil((filteredProducts?.length ?? 0) / CATEGORY_PRODUCT_PAGE_SIZE),
  );
  const categoryPageIndex = Math.min(requestedPageIndex, pageCount - 1);

  useEffect(() => {
    if (isLoadingProducts || requestedPageIndex === categoryPageIndex) return;

    void navigate({
      replace: true,
      search: ((current: Record<string, unknown>) =>
        writeCategoryProductPageSearch(
          current,
          categoryPageIndex,
        )) as never,
    });
  }, [categoryPageIndex, isLoadingProducts, navigate, requestedPageIndex]);

  const handleCategoryPageIndexChange = (nextPageIndex: number) => {
    void navigate({
      replace: true,
      search: ((current: Record<string, unknown>) =>
        writeCategoryProductPageSearch(current, nextPageIndex)) as never,
    });
  };

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
            {categorySlug && !isLoadingProducts ? (
              <CategoryWorkspaceActions
                categorySlug={categorySlug}
                outOfStockProductsCount={outOfStockProducts?.length || 0}
                selectedProductActions={selectedProductActions}
                setSelectedProductActions={setSelectedProductActions}
                hasProducts={products?.length != 0}
              />
            ) : null}
            {isLoadingProducts ? null : (
              <StoreProducts
                products={filteredProducts}
                onPageIndexChange={handleCategoryPageIndexChange}
                pageIndex={categoryPageIndex}
              />
            )}
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
