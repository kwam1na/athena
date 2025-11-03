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
}

export function ProductEntry({
  showProductLookup,
  setShowProductLookup,
  productSearchQuery,
  setProductSearchQuery,
  onBarcodeSubmit,
  onAddProduct,
  barcodeSearchResult,
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
  const filteredProducts = searchResults || [];
  const isLoading = showResults && searchResults === undefined;

  const formatter = currencyFormatter(activeStore?.currency || "GHS");
  return (
    <Card className="border-2 border-dashed border-gray-200 hover:border-gray-300 transition-colors">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base font-medium text-gray-800">
          <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
            <Search className="w-4 h-4 text-blue-600" />
          </div>
          Add Products
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Primary Product Lookup Button */}
        <Button
          size="lg"
          variant="outline"
          className={`w-full h-14 font-medium transition-all duration-200 ${
            showProductLookup
              ? "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
              : "hover:bg-gray-50 hover:shadow-sm"
          }`}
          onClick={() => setShowProductLookup(!showProductLookup)}
        >
          <div className="flex items-center justify-center gap-3">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center ${
                showProductLookup ? "bg-blue-200" : "bg-gray-100"
              }`}
            >
              <Search className="w-4 h-4" />
            </div>
            <span className="text-sm">
              {showProductLookup
                ? "Hide product search"
                : "Search products to add items"}
            </span>
            {showProductLookup ? (
              <ChevronUp className="w-5 h-5" />
            ) : (
              <ChevronDown className="w-5 h-5" />
            )}
          </div>
        </Button>

        {/* Product Lookup Section */}
        {showProductLookup && (
          <div className="space-y-4 border-2 rounded-xl p-5 bg-gradient-to-br from-blue-50/50 to-indigo-50/30 border-blue-100">
            {/* Unified Search Input - handles both product search and barcode scanning */}
            <div className="relative">
              <div className="absolute left-4 top-1/2 transform -translate-y-1/2 flex items-center gap-2">
                <Search className="text-gray-400 w-4 h-4" />
                <ScanBarcode className="text-gray-400 w-4 h-4" />
              </div>
              <Input
                placeholder="Search by name, scan barcode, or paste QR code URL..."
                value={productSearchQuery}
                onChange={(e) => setProductSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Auto-submit on Enter for barcodes/URLs
                  if (e.key === "Enter" && productSearchQuery.trim()) {
                    e.preventDefault();
                    onBarcodeSubmit(e);
                  }
                }}
                className="h-12 pl-20 pr-10 border-2 border-gray-200 focus:border-blue-400 rounded-lg text-sm font-medium bg-white/80 backdrop-blur-sm"
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

            {/* Helper text */}
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <span className="inline-flex items-center gap-1">
                <span className="font-medium">Tip:</span> Type to search, scan
                barcode, or press Enter to add by code
              </span>
            </p>

            {/* Barcode/URL Product Result */}
            {inputIsUrlOrBarcode &&
              productSearchQuery.trim() &&
              barcodeSearchResult && (
                <div className="max-h-96 overflow-y-auto space-y-1">
                  <div className="space-y-2">
                    <div
                      className={`group flex items-center gap-4 p-4 border-2 rounded-xl transition-all duration-200 cursor-pointer bg-white/80 backdrop-blur-sm ${
                        !barcodeSearchResult.inStock
                          ? "opacity-50 border-gray-200 hover:border-gray-300"
                          : "border-gray-200 hover:border-blue-300 hover:shadow-md hover:shadow-blue-100/50"
                      }`}
                      onClick={() => {
                        if (barcodeSearchResult.inStock) {
                          onAddProduct(barcodeSearchResult);
                          setShowProductLookup(false);
                          setProductSearchQuery("");
                        }
                      }}
                    >
                      <div className="w-12 h-12 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden border-2 border-gray-100">
                        {barcodeSearchResult.image ? (
                          <img
                            src={barcodeSearchResult.image}
                            alt={barcodeSearchResult.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Package className="w-5 h-5 text-gray-400" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-semibold text-sm text-gray-900 truncate group-hover:text-blue-900">
                            {capitalizeWords(barcodeSearchResult.name)}
                          </h4>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Badge
                              variant="secondary"
                              className="text-xs font-bold"
                            >
                              {formatter.format(barcodeSearchResult.price)}
                            </Badge>
                            {!barcodeSearchResult.inStock && (
                              <Badge variant="destructive" className="text-xs">
                                Out of Stock
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mt-1">
                          {barcodeSearchResult.sku && (
                            <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-1 rounded">
                              SKU: {barcodeSearchResult.sku}
                            </span>
                          )}
                          <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-1 rounded">
                            {barcodeSearchResult.barcode}
                          </span>
                          {barcodeSearchResult.category && (
                            <Badge variant="outline" className="text-xs">
                              {barcodeSearchResult.category}
                            </Badge>
                          )}
                        </div>

                        {(barcodeSearchResult.size ||
                          barcodeSearchResult.length) && (
                          <div className="flex items-center gap-2 mt-2">
                            {barcodeSearchResult.size && (
                              <Badge variant="outline" className="text-xs">
                                Size: {barcodeSearchResult.size}
                              </Badge>
                            )}
                            {barcodeSearchResult.length && (
                              <Badge variant="outline" className="text-xs">
                                Length: {barcodeSearchResult.length}"
                              </Badge>
                            )}
                          </div>
                        )}

                        {barcodeSearchResult.quantityAvailable && (
                          <p className="text-xs text-gray-500 mt-1">
                            {barcodeSearchResult.quantityAvailable} available in
                            stock
                          </p>
                        )}
                      </div>

                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (barcodeSearchResult.inStock) {
                            onAddProduct(barcodeSearchResult);
                            setShowProductLookup(false);
                            setProductSearchQuery("");
                          }
                        }}
                        disabled={!barcodeSearchResult.inStock}
                        className={`flex-shrink-0 transition-all duration-200 ${
                          barcodeSearchResult.inStock
                            ? "bg-green-600 hover:bg-green-700 text-white shadow-md hover:shadow-lg group-hover:scale-105"
                            : "bg-gray-300 text-gray-500 cursor-not-allowed"
                        }`}
                      >
                        {barcodeSearchResult.inStock ? (
                          <>
                            <Plus className="w-3 h-3 mr-1" />
                            Add
                          </>
                        ) : (
                          "Unavailable"
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

            {/* Barcode/URL No Result Message */}
            {inputIsUrlOrBarcode &&
              debouncedForNoResults.trim() &&
              !barcodeSearchResult && (
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

            {/* Search Results */}
            {showResults && (
              <div className="max-h-96 overflow-y-auto space-y-1">
                {isLoading ? (
                  <div className="text-center py-8 text-gray-500">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-sm font-medium">Searching products...</p>
                  </div>
                ) : filteredProducts.length > 0 ? (
                  <div className="space-y-2">
                    {filteredProducts.slice(0, 10).map((product: Product) => (
                      <div
                        key={product.id}
                        className={`group flex items-center gap-4 p-4 border-2 rounded-xl transition-all duration-200 cursor-pointer bg-white/80 backdrop-blur-sm ${
                          !product.inStock
                            ? "opacity-50 border-gray-200 hover:border-gray-300"
                            : "border-gray-200 hover:border-blue-300 hover:shadow-md hover:shadow-blue-100/50"
                        }`}
                        onClick={() => {
                          if (product.inStock) {
                            onAddProduct(product);
                            setShowProductLookup(false);
                            setProductSearchQuery("");
                          }
                        }}
                      >
                        <div className="w-12 h-12 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden border-2 border-gray-100">
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
                            <h4 className="font-semibold text-sm text-gray-900 truncate group-hover:text-blue-900">
                              {capitalizeWords(product.name)}
                            </h4>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <Badge
                                variant="secondary"
                                className="text-xs font-bold"
                              >
                                {formatter.format(product.price)}
                              </Badge>
                              {/* {!product.areProcessingFeesAbsorbed && (
                                <Badge
                                  variant="outline"
                                  className="text-xs text-green-700 bg-green-50 border-green-200"
                                >
                                  net
                                </Badge>
                              )} */}
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
                              <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                SKU: {product.sku}
                              </span>
                            )}
                            <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-1 rounded">
                              {product.barcode}
                            </span>
                            {product.category && (
                              <Badge variant="outline" className="text-xs">
                                {product.category}
                              </Badge>
                            )}
                          </div>

                          {(product.size || product.length) && (
                            <div className="flex items-center gap-2 mt-2">
                              {product.size && (
                                <Badge variant="outline" className="text-xs">
                                  Size: {product.size}
                                </Badge>
                              )}
                              {product.length && (
                                <Badge variant="outline" className="text-xs">
                                  Length: {product.length}"
                                </Badge>
                              )}
                            </div>
                          )}

                          {product.quantityAvailable && (
                            <p className="text-xs text-gray-500 mt-1">
                              {product.quantityAvailable} available in stock
                            </p>
                          )}
                        </div>

                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (product.inStock) {
                              onAddProduct(product);
                              setShowProductLookup(false);
                              setProductSearchQuery("");
                            }
                          }}
                          disabled={!product.inStock}
                          className={`flex-shrink-0 transition-all duration-200 ${
                            product.inStock
                              ? "bg-green-600 hover:bg-green-700 text-white shadow-md hover:shadow-lg group-hover:scale-105"
                              : "bg-gray-300 text-gray-500 cursor-not-allowed"
                          }`}
                        >
                          {product.inStock ? (
                            <>
                              <Plus className="w-3 h-3 mr-1" />
                              Add
                            </>
                          ) : (
                            "Unavailable"
                          )}
                        </Button>
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
      </CardContent>
    </Card>
  );
}
