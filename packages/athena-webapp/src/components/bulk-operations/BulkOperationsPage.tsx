import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { useBulkOperations } from "~/src/hooks/useBulkOperations";
import { useGetCategories } from "~/src/hooks/useGetCategories";
import { BulkOperationsFilters } from "./BulkOperationsFilters";
import { BulkOperationsPreview } from "./BulkOperationsPreview";
import View from "../View";
import { useState, useCallback, useMemo } from "react";
import { Id } from "~/convex/_generated/dataModel";
import { EmptyState } from "../states/empty/empty-state";
import { PackageSearch, SearchX } from "lucide-react";

export default function BulkOperationsPage() {
  const { activeStore } = useGetActiveStore();
  const categories = useGetCategories();
  const [filterParams, setFilterParams] = useState<{
    categorySlug?: string;
    nameSearch?: string;
  } | null>(null);

  const {
    skus,
    operation,
    operationValue,
    excludedSkuIds,
    isApplying,
    hasPreview,
    previewRows,
    selectedPreviewRows,
    validSelectedRows,
    validationError,
    setOperation,
    setOperationValue,
    loadSkus,
    calculatePreview,
    toggleSkuExclusion,
    selectAll,
    deselectAll,
    applyChanges,
  } = useBulkOperations();

  const products = useQuery(
    api.inventory.products.getAll,
    activeStore?._id && filterParams
      ? {
          storeId: activeStore._id,
          category: filterParams.categorySlug
            ? [filterParams.categorySlug]
            : undefined,
          filters: { isPriceZero: true },
        }
      : "skip"
  );

  // Build a category ID → name lookup from fetched categories
  const categoryMap = useMemo(() => {
    if (!categories) return new Map<string, string>();
    return new Map(categories.map((c) => [c._id, c.name]));
  }, [categories]);

  // Collect all unique color IDs from loaded products to resolve names
  const colorIds = useMemo(() => {
    if (!products) return [];
    const ids = new Set<Id<"color">>();
    for (const product of products) {
      for (const sku of product.skus) {
        if (sku.color) ids.add(sku.color);
      }
    }
    return Array.from(ids);
  }, [products]);

  // Fetch color details for all referenced colors
  const colors = useQuery(
    api.inventory.colors.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const colorMap = useMemo(() => {
    if (!colors) return new Map<string, string>();
    return new Map(colors.map((c: any) => [c._id, c.name]));
  }, [colors]);

  // When products arrive from the query, process them into the hook
  const isLoading = filterParams !== null && products === undefined;

  // Load products into the bulk operations hook when query results arrive
  const productsLoaded =
    filterParams !== null && products !== undefined && products !== null;

  // Filter by name client-side if a search term was provided
  const filteredProducts = productsLoaded
    ? filterParams.nameSearch
      ? products.filter((p) =>
          p.name.toLowerCase().includes(filterParams.nameSearch!.toLowerCase())
        )
      : products
    : null;

  // Enrich products with category names and SKUs with color names
  const enrichedProducts = useMemo(() => {
    if (!filteredProducts) return null;
    return filteredProducts.map((product) => ({
      ...product,
      categoryName: categoryMap.get(product.categoryId) || undefined,
      skus: product.skus.map((sku) => ({
        ...sku,
        colorName: sku.color ? colorMap.get(sku.color) || undefined : undefined,
      })),
    }));
  }, [filteredProducts, categoryMap, colorMap]);

  // Auto-load SKUs when enriched products are ready
  if (enrichedProducts && enrichedProducts.length > 0 && skus.length === 0) {
    loadSkus(enrichedProducts);
  }

  // Determine empty states
  const hasSearched = filterParams !== null && !isLoading;
  const noProductsFound = hasSearched && enrichedProducts?.length === 0;
  const productsLoadedButNoSkus =
    hasSearched &&
    enrichedProducts &&
    enrichedProducts.length > 0 &&
    enrichedProducts.every((p) => p.skus.length === 0);

  // Handle re-loading when filter params change: reset SKUs
  const handleLoadProductsWithReset = useCallback(
    (categorySlug?: string, nameSearch?: string) => {
      // Force a fresh load by clearing current state
      loadSkus([]);
      setFilterParams({ categorySlug, nameSearch });
    },
    [loadSkus]
  );

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      header={
        <div className="container mx-auto flex gap-2">
          <div className="flex items-center gap-8">
            <p className="font-medium">Bulk Operations</p>
          </div>
        </div>
      }
    >
      <div className="container mx-auto space-y-6 py-6">
        <BulkOperationsFilters
          operation={operation}
          operationValue={operationValue}
          validationError={validationError}
          skuCount={skus.length}
          hasPreview={hasPreview}
          onOperationChange={setOperation}
          onOperationValueChange={setOperationValue}
          onLoadProducts={handleLoadProductsWithReset}
          onCalculatePreview={calculatePreview}
          isLoading={isLoading}
        />

        {(noProductsFound || productsLoadedButNoSkus) && (
          <EmptyState
            icon={<SearchX className="w-10 h-10" />}
            title="No products found"
            description={
              filterParams?.nameSearch
                ? `No products matching "${filterParams.nameSearch}" were found. Try adjusting your filters.`
                : "No products matched your filters. Try selecting a different category or clearing your filters."
            }
          />
        )}

        {hasPreview && previewRows.length > 0 && (
          <BulkOperationsPreview
            previewRows={previewRows}
            excludedSkuIds={excludedSkuIds}
            selectedCount={selectedPreviewRows.length}
            validSelectedCount={validSelectedRows.length}
            isApplying={isApplying}
            onToggleExclusion={toggleSkuExclusion}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
            onApply={applyChanges}
          />
        )}
      </div>
    </View>
  );
}
