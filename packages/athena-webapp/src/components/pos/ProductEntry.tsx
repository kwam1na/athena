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
import { NoResultsMessage } from "./NoResultsMessage";
import { useProductSearchResults } from "@/hooks/useProductSearchResults";

interface ProductEntryProps {
  showProductLookup: boolean;
  setShowProductLookup: (value: boolean) => void;
  productSearchQuery: string;
  setProductSearchQuery: (query: string) => void;
  onBarcodeSubmit: (e: React.FormEvent) => void;
  onAddProduct: (product: Product) => void;
  barcodeSearchResult?: Product | Product[] | null;
  productIdSearchResults?: Product[] | null;
  disabled?: boolean;
}

export function ProductEntry({
  disabled,
  showProductLookup,
  setShowProductLookup,
  productSearchQuery,
  setProductSearchQuery,
  onBarcodeSubmit,
  onAddProduct,
  barcodeSearchResult,
  productIdSearchResults,
}: ProductEntryProps) {
  const { activeStore } = useGetActiveStore();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const debouncedProductSearchQuery = useDebounce(
    productSearchQuery,
    POS_SEARCH_DEBOUNCE_MS
  );

  // Fetch search results
  const searchResults = usePOSProductSearch(
    activeStore?._id,
    debouncedProductSearchQuery
  );

  // Focus the input when component mounts or when showProductLookup changes
  useEffect(() => {
    if (showProductLookup && searchInputRef.current && !disabled) {
      // Use setTimeout to ensure DOM is ready and other focus operations are complete
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [showProductLookup, disabled]);

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

  return (
    <div>
      <div className="space-y-6">
        {/* Product Lookup Section */}
        {showProductLookup && (
          <div className="space-y-4 border rounded-lg p-5 bg-gradient-to-br from-gray-50/50 to-gray-100/30 border-gray-200">
            {/* Unified Search Input - handles both product search and barcode scanning */}
            <div className="relative">
              <div className="absolute text-gray-500 z-10 left-4 top-1/2 transform -translate-y-1/2 flex items-center gap-2">
                <Search className="t w-4 h-4" />
                <ScanBarcode className="w-4 h-4" />
              </div>
              <Input
                ref={searchInputRef}
                placeholder="Lookup product by name, bar/qr code, sku, or product url..."
                value={productSearchQuery}
                disabled={disabled}
                onChange={(e) => setProductSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Auto-submit on Enter for barcodes/URLs
                  if (e.key === "Enter" && productSearchQuery.trim()) {
                    e.preventDefault();
                    onBarcodeSubmit(e);
                  }
                }}
                className="h-12 pl-20 pr-10  border-gray-200 focus:border-blue-400 rounded-lg text-sm font-medium bg-white/80 backdrop-blur-sm"
                autoFocus
                autoComplete="off"
              />
              {productSearchQuery && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 h-8 w-8 p-0 hover:bg-gray-100"
                  onClick={handleClearSearch}
                >
                  ×
                </Button>
              )}
            </div>

            {productSearchQuery && (
              <SearchResultsSection
                isLoading={isLoading}
                products={filteredProducts}
                onAddProduct={onAddProduct}
                formatter={formatter}
                onClearSearch={handleClearSearch}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
