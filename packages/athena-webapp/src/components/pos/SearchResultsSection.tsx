import { PackagePlus, Search } from "lucide-react";
import { Product } from "./types";
import { ProductCard } from "./ProductCard";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "../ui/skeleton";

interface SearchResultsSectionProps {
  isLoading: boolean;
  products: Product[];
  onAddProduct: (product: Product) => void;
  formatter: Intl.NumberFormat;
  onClearSearch: () => void;
  onQuickAddProduct?: (product?: Product) => void;
  quickAddQuery?: string;
  className?: string;
}

const SEARCH_RESULTS_LOADING_ROWS = 4;

function SearchResultsLoadingSkeleton() {
  return (
    <div className="space-y-8 py-8">
      {Array.from({ length: SEARCH_RESULTS_LOADING_ROWS }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white/80 p-3"
        >
          <Skeleton className="h-16 w-16 rounded flex-shrink-0 self-center mx-1 mt-4" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-7 w-28" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-24 rounded-full" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-12 rounded-full" />
              <Skeleton className="h-4 w-12 rounded-full" />
            </div>
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SearchResultsSection({
  isLoading,
  products,
  onAddProduct,
  formatter,
  onClearSearch,
  onQuickAddProduct,
  quickAddQuery,
  className,
}: SearchResultsSectionProps) {
  const allResultsForSameProduct =
    products.length > 0 &&
    products[0].productId !== undefined &&
    products.every((product) => product.productId === products[0].productId);

  if (isLoading) {
    return (
      <div className={cn("max-h-[586px] space-y-1 overflow-y-auto", className)}>
        <span className="sr-only">Searching products…</span>
        <SearchResultsLoadingSkeleton />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className={cn("max-h-[586px] space-y-1 overflow-y-auto", className)}>
        <div className="flex h-full flex-col items-center justify-center py-8 text-center text-gray-500">
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Search className="w-6 h-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium">No products found</p>
          <p className="text-xs text-gray-400 mt-1">
            Try a different search term or check spelling
          </p>
          {onQuickAddProduct && (
            <Button
              type="button"
              size="sm"
              className="mt-5"
              onClick={() => onQuickAddProduct?.()}
            >
              <PackagePlus className="mr-2 h-4 w-4" />
              Quick add product
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("max-h-[586px] space-y-1 overflow-y-auto", className)}>
      <div className="space-y-8 py-8">
        {products.map((product: Product) => (
          <ProductCard
            key={product.id}
            product={product}
            onAddProduct={onAddProduct}
            formatter={formatter}
            onAfterAdd={onClearSearch}
          />
        ))}
        {onQuickAddProduct && allResultsForSameProduct && (
          <div className="flex justify-center pb-8">
            <Button
              type="button"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => onQuickAddProduct(products[0])}
            >
              <PackagePlus className="mr-2 h-4 w-4" />
              Add variant for this product
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
