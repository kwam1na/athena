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
import { PAYSTACK_PROCESSING_FEE } from "@/lib/constants";

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
}

// Utility function to calculate POS display price
const calculatePOSPrice = (product: Product): number => {
  if (!product.areProcessingFeesAbsorbed) {
    // If merchant doesn't absorb fees, show base price (minus processing fees)
    // This shows what the merchant actually receives
    const processingFee = (product.price * PAYSTACK_PROCESSING_FEE) / 100;
    return product.price - processingFee;
  }
  // If merchant absorbs fees, show the full price
  return product.price;
};

export function ProductEntry({
  barcodeInput,
  setBarcodeInput,
  isScanning,
  setIsScanning,
  showProductLookup,
  setShowProductLookup,
  productSearchQuery,
  setProductSearchQuery,
  onBarcodeSubmit,
  onAddProduct,
}: ProductEntryProps) {
  const { activeStore } = useGetActiveStore();
  const searchResults = usePOSProductSearch(
    activeStore?._id,
    productSearchQuery
  );

  const showResults = productSearchQuery.trim().length > 0;
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
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search products by name..."
                value={productSearchQuery}
                onChange={(e) => setProductSearchQuery(e.target.value)}
                className="h-12 border-2 border-gray-200 focus:border-blue-400 rounded-lg text-sm font-medium bg-white/80 backdrop-blur-sm"
                autoFocus
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
                                {formatter.format(calculatePOSPrice(product))}
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

        {/* Disabled Barcode Entry Section */}
        {/* <div className="space-y-4 p-4 bg-amber-50 border-2 border-amber-200 rounded-xl">
          <div className="flex items-center gap-3 text-sm text-amber-700">
            <div className="w-6 h-6 bg-amber-200 rounded-full flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-4 h-4" />
            </div>
            <span className="font-medium">
              Barcode scanner functionality coming soon
            </span>
          </div>

          <form onSubmit={onBarcodeSubmit} className="flex gap-2">
            <Input
              placeholder="Barcode entry temporarily disabled..."
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              className="flex-1 bg-white/60 border-amber-200"
              disabled
            />
            <Button
              type="submit"
              disabled
              className="bg-amber-300 text-amber-800 cursor-not-allowed"
            >
              Add Item
            </Button>
          </form>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 bg-white/60 border-amber-200 text-amber-700 cursor-not-allowed"
              disabled
            >
              <ScanBarcode className="w-4 h-4 mr-2" />
              Use Scanner
            </Button>
          </div>
        </div> */}
      </CardContent>
    </Card>
  );
}
