import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanBarcode, Search } from "lucide-react";
import { Product } from "./types";
import { usePOSProductSearch } from "@/hooks/usePOSProducts";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { currencyFormatter } from "~/convex/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { isUrlOrBarcode } from "@/lib/pos/barcodeUtils";
import {
  POS_SEARCH_DEBOUNCE_MS,
  POS_QUERY_BUFFER_MS,
} from "@/lib/pos/constants";
import { useRef, useEffect } from "react";
import { SearchResultsSection } from "./SearchResultsSection";
import { useProductSearchResults } from "@/hooks/useProductSearchResults";
import { cn } from "@/lib/utils";

interface ProductSearchInputProps {
  productSearchQuery: string;
  setProductSearchQuery: (query: string) => void;
  onBarcodeSubmit: (e: React.FormEvent) => void;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}

interface ProductEntryProps extends ProductSearchInputProps {
  showProductLookup: boolean;
  setShowProductLookup: (value: boolean) => void;
  onAddProduct: (product: Product) => void;
  barcodeSearchResult?: Product | Product[] | null;
  productIdSearchResults?: Product[] | null;
  showSearchInput?: boolean;
  containerClassName?: string;
  lookupPanelClassName?: string;
  resultsClassName?: string;
}

export function ProductSearchInput({
  disabled,
  productSearchQuery,
  setProductSearchQuery,
  onBarcodeSubmit,
  className,
  inputClassName,
}: ProductSearchInputProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!disabled) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [disabled]);

  const handleClearSearch = () => {
    setProductSearchQuery("");
  };

  return (
    <div className={cn("relative", className)}>
      <div className="absolute text-gray-500 z-10 left-4 top-1/2 transform -translate-y-1/2 flex items-center gap-2">
        <Search className="w-4 h-4" />
        <ScanBarcode className="w-4 h-4" />
      </div>
      <Input
        ref={searchInputRef}
        placeholder="Lookup product by name, bar/qr code, sku, or product url..."
        value={productSearchQuery}
        disabled={disabled}
        onChange={(e) => setProductSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && productSearchQuery.trim()) {
            e.preventDefault();
            onBarcodeSubmit(e);
          }
        }}
        className={cn(
          "h-12 pl-20 pr-10 border-gray-200 focus:border-blue-400 rounded-lg text-sm font-medium bg-white/80 backdrop-blur-sm",
          inputClassName,
        )}
        autoFocus
        autoComplete="off"
      />
      {productSearchQuery && (
        <Button
          size="icon"
          variant="ghost"
          className="absolute right-1.5 top-1/2 h-10 w-10 -translate-y-1/2 transform hover:bg-gray-100"
          onClick={handleClearSearch}
        >
          ×
        </Button>
      )}
    </div>
  );
}

export function ProductEntry({
  disabled,
  showProductLookup,
  productSearchQuery,
  setProductSearchQuery,
  onBarcodeSubmit,
  onAddProduct,
  barcodeSearchResult,
  productIdSearchResults,
  showSearchInput = true,
  containerClassName,
  lookupPanelClassName,
  resultsClassName,
}: ProductEntryProps) {
  const { activeStore } = useGetActiveStore();

  const debouncedProductSearchQuery = useDebounce(
    productSearchQuery,
    POS_SEARCH_DEBOUNCE_MS
  );

  // Fetch search results
  const searchResults = usePOSProductSearch(
    activeStore?._id,
    debouncedProductSearchQuery
  );

  // Debounce for "no results" message to allow search query to complete
  const debouncedForNoResults = useDebounce(
    productSearchQuery,
    POS_SEARCH_DEBOUNCE_MS + POS_QUERY_BUFFER_MS
  );

  // Check if input is a URL or barcode (vs a product search term)
  const inputIsUrlOrBarcode = isUrlOrBarcode(productSearchQuery);

  // Consolidate search result logic with proper prioritization
  const { filteredProducts, isLoading } = useProductSearchResults({
    searchResults,
    barcodeSearchResult,
    productIdSearchResults,
    inputIsUrlOrBarcode,
    debouncedQuery: debouncedForNoResults,
  });

  const formatter = currencyFormatter(activeStore?.currency || "GHS");

  // Handler to clear search after adding product
  const handleClearSearch = () => {
    setProductSearchQuery("");
  };

  if (!showProductLookup || (!showSearchInput && !productSearchQuery)) {
    return null;
  }

  return (
    <div className={containerClassName}>
      <div className={cn("space-y-6", containerClassName && "h-full")}>
        {/* Product Lookup Section */}
        <div
          className={cn(
            "space-y-4 rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50/50 to-gray-100/30 p-5",
            lookupPanelClassName,
          )}
        >
          {showSearchInput && (
            <ProductSearchInput
              disabled={disabled}
              productSearchQuery={productSearchQuery}
              setProductSearchQuery={setProductSearchQuery}
              onBarcodeSubmit={onBarcodeSubmit}
            />
          )}

          {productSearchQuery && (
            <SearchResultsSection
              isLoading={isLoading}
              products={filteredProducts}
              onAddProduct={onAddProduct}
              formatter={formatter}
              onClearSearch={handleClearSearch}
              className={resultsClassName}
            />
          )}
        </div>
      </div>
    </div>
  );
}
