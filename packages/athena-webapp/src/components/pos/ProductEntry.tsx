import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ScanBarcode,
  Search,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Plus,
  Package,
  Sparkles,
} from "lucide-react";
import { CartItem, Product } from "./types";
import { usePOSProductSearch } from "@/hooks/usePOSProducts";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { currencyFormatter } from "~/convex/utils";
import { capitalizeWords } from "~/src/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { isUrlOrBarcode } from "@/lib/pos/barcodeUtils";
import {
  POS_SEARCH_DEBOUNCE_MS,
  POS_QUERY_BUFFER_MS,
} from "@/lib/pos/constants";

interface ProductEntryProps {
  barcodeInput: string;
  setBarcodeInput: (value: string) => void;
  isScanning: boolean;
  setIsScanning: (value: boolean) => void;
  showProductLookup: boolean;
  setShowProductLookup: (value: boolean) => void;
  productSearchQuery: string;
  setProductSearchQuery: (query: string) => void;
  onBarcodeSubmit: (e: React.FormEvent) => void;
  onAddProduct: (product: Product) => void;
  barcodeSearchResult?: Product | null;
  productIdSearchResults?: Product[] | null;
}

export function ProductEntry({
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
  const searchResults = usePOSProductSearch(
    activeStore?._id,
    productSearchQuery
  );

  // Debounce for "no results" message to allow search query to complete
  // This accounts for: debounce time (450ms) + query execution time (300ms) = 750ms total
  // Prevents flickering by waiting for both the debounce AND the query to complete
  const debouncedForNoResults = useDebounce(
    productSearchQuery,
    POS_SEARCH_DEBOUNCE_MS + POS_QUERY_BUFFER_MS
  );

  // Check if input is a URL or barcode (vs a product search term)
  const inputIsUrlOrBarcode = isUrlOrBarcode(productSearchQuery);
  const showResults =
    productSearchQuery.trim().length > 0 && !inputIsUrlOrBarcode;

  // Use product ID results if available, otherwise use regular search results
  const filteredProducts = productIdSearchResults || searchResults || [];
  const isLoading =
    showResults && searchResults === undefined && !productIdSearchResults;

  const formatter = currencyFormatter(activeStore?.currency || "GHS");
  return (
    <div>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center">
            <Search className="w-4 h-4" />
          </div>
          Product Lookup
        </CardTitle>
      </CardHeader>
      <div className="space-y-6">
        {/* Product Lookup Section */}
        {showProductLookup && (
          <div className="space-y-4 border rounded-lg p-5 bg-gradient-to-br from-gray-50/50 to-gray-100/30 border-gray-200">
            {/* Unified Search Input - handles both product search and barcode scanning */}
            <div className="relative">
              <div className="absolute left-4 top-1/2 transform -translate-y-1/2 flex items-center gap-2">
                <Search className="text-gray-400 w-4 h-4" />
                <ScanBarcode className="text-gray-400 w-4 h-4" />
              </div>
              <Input
                placeholder="Search by name, bar/qr code, or product url..."
                value={productSearchQuery}
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
                  onClick={() => setProductSearchQuery("")}
                >
                  ×
                </Button>
              )}
            </div>

            {/* Barcode/URL No Result Message */}
            {inputIsUrlOrBarcode &&
              debouncedForNoResults.trim() &&
              !barcodeSearchResult &&
              (!productIdSearchResults ||
                productIdSearchResults.length === 0) && (
                <div className="p-4 bg-amber-50 border-2 border-amber-200 rounded-lg">
                  <div className="flex items-center gap-3 text-amber-700">
                    <div className="w-8 h-8 bg-amber-200 rounded-full flex items-center justify-center flex-shrink-0">
                      <AlertCircle className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">No product found</p>
                      <p className="text-xs text-amber-600 mt-1">
                        The barcode/QR code doesn't match any products in the
                        system
                      </p>
                    </div>
                  </div>
                </div>
              )}

            {/* Search Results - Show if regular search OR product ID results */}
            {(showResults ||
              (productIdSearchResults &&
                productIdSearchResults.length > 0)) && (
              <div className="max-h-[586px] overflow-y-auto space-y-1">
                {isLoading ? (
                  <div className="text-center py-8 text-gray-500">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-sm font-medium">Searching products...</p>
                  </div>
                ) : filteredProducts.length > 0 ? (
                  <div className="space-y-8 py-8">
                    {filteredProducts.slice(0, 10).map((product: Product) => (
                      <div
                        key={product.id}
                        className={`group flex items-center gap-4 p-4 border rounded-lg transition-all duration-200 cursor-pointer bg-white/80 backdrop-blur-sm ${
                          !product.inStock
                            ? "opacity-50 border-gray-200 hover:border-gray-300"
                            : "border-gray-200 hover:border-blue-200 hover:shadow-md hover:shadow-blue-100/50"
                        }`}
                        onClick={() => {
                          if (product.inStock) {
                            onAddProduct(product);

                            setProductSearchQuery("");
                          }
                        }}
                      >
                        <div className="w-16 h-16 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden border-2 border-gray-100">
                          {product.image ? (
                            <img
                              src={product.image}
                              alt={product.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Package className="w-5 h-5 text-gray-400" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="font-semibold text-md text-gray-600 truncate group-hover:text-gray-900">
                              {capitalizeWords(product.name)}
                            </h4>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <Badge
                                variant="outline"
                                className="text-md font-bold"
                              >
                                {formatter.format(product.price)}
                              </Badge>

                              {!product.inStock && (
                                <Badge
                                  variant="destructive"
                                  className="text-xs"
                                >
                                  Out of Stock
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 mt-1">
                            {product.sku && (
                              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                {product.sku}
                              </span>
                            )}
                            {product.barcode && (
                              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                {product.barcode}
                              </span>
                            )}
                          </div>

                          {(product.size || product.length) && (
                            <div className="flex items-center gap-2 mt-2">
                              {product.category && (
                                <Badge variant="outline" className="text-xs">
                                  {product.category}
                                </Badge>
                              )}
                              {product.length && (
                                <Badge variant="outline" className="text-xs">
                                  {product.length}"
                                </Badge>
                              )}
                              {product.size && (
                                <Badge variant="outline" className="text-xs">
                                  {product.size}
                                </Badge>
                              )}
                            </div>
                          )}

                          {product.quantityAvailable && (
                            <p className="text-xs text-gray-500 mt-4">
                              <b>{product.quantityAvailable}</b> available
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                    {filteredProducts.length > 10 && (
                      <div className="text-center py-3">
                        <Badge variant="secondary" className="text-xs">
                          Showing first 10 results • Type more to narrow down
                        </Badge>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Search className="w-6 h-6 text-gray-400" />
                    </div>
                    <p className="text-sm font-medium">No products found</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Try a different search term or check spelling
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
