import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import * as Collapsible from "@radix-ui/react-collapsible";
import { Search, Plus, Package } from "lucide-react";
import { Product } from "./types";
import { usePOSProductSearch } from "@/hooks/usePOSProducts";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { currencyFormatter } from "~/convex/utils";
import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";
import { Skeleton } from "../ui/skeleton";

interface ProductLookupProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onAddProduct: (product: Product) => void;
}

const PRODUCT_LOOKUP_LOADING_ROWS = 3;

function ProductLookupLoadingSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: PRODUCT_LOOKUP_LOADING_ROWS }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-lg border border-muted/80 bg-white/80 p-3"
        >
          <Skeleton className="h-10 w-10 rounded-md flex-shrink-0 self-center" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-28 rounded-full" />
              <Skeleton className="h-3 w-24 rounded-full" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-12 rounded-full" />
              <Skeleton className="h-3 w-20 rounded-full" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
          <Skeleton className="h-8 w-16 rounded-md" />
        </div>
      ))}
    </div>
  );
}

export function ProductLookup({
  isOpen,
  onOpenChange,
  searchQuery,
  setSearchQuery,
  onAddProduct,
}: ProductLookupProps) {
  const { activeStore } = useGetActiveStore();
  const searchResults = usePOSProductSearch(activeStore?._id, searchQuery);

  const showResults = searchQuery.trim().length > 0;
  const filteredProducts = searchResults || [];
  const isLoading = showResults && searchResults === undefined;

  const formatter = currencyFormatter(activeStore?.currency || "GHS");

  return (
    <Collapsible.Root open={isOpen} onOpenChange={onOpenChange}>
      <Collapsible.Content>
        <Card>
          <CardContent className="p-4">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Search products by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                autoFocus
              />
            </div>

            {/* Search Results */}
            {showResults && (
              <div className="mt-3 max-h-[80%] overflow-y-auto">
                {isLoading ? (
                  <div className="py-2">
                    <span className="sr-only">Searching products…</span>
                    <ProductLookupLoadingSkeleton />
                  </div>
                ) : filteredProducts.length > 0 ? (
                  <div className="space-y-2">
                    {filteredProducts.map((product) => (
                      <div
                        key={product.id}
                        className={`flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors ${!product.inStock ? "opacity-60" : ""}`}
                      >
                        <div className="w-10 h-10 bg-muted rounded flex items-center justify-center flex-shrink-0">
                          {product.image ? (
                            <img
                              src={product.image}
                              alt={product.name}
                              className="w-full h-full object-cover rounded"
                            />
                          ) : (
                            <Package className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-sm truncate">
                            {product.name}
                          </h4>
                          <p className="text-xs text-muted-foreground">
                            {product.sku && `SKU: ${product.sku} • `}
                            {product.barcode}{" "}
                            {product.category && `• ${product.category}`}
                          </p>
                          {(product.size || product.length) && (
                            <p className="text-xs text-muted-foreground">
                              {product.size && `Size: ${product.size}`}
                              {product.size && product.length && " • "}
                              {product.length && `Length: ${product.length}"`}
                            </p>
                          )}
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold">
                              {formatStoredAmount(formatter, product.price)}
                            </p>
                            {product.quantityAvailable && (
                              <span className="text-xs text-muted-foreground">
                                ({product.quantityAvailable} available)
                              </span>
                            )}
                          </div>
                        </div>

                        <Button
                          size="sm"
                          onClick={() => onAddProduct(product)}
                          disabled={!product.inStock}
                          className="flex-shrink-0"
                        >
                          {product.inStock ? (
                            <>
                              <Plus className="w-3 h-3 mr-1" />
                              Add
                            </>
                          ) : (
                            "Out of Stock"
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground">
                    <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No products found</p>
                    <p className="text-xs">Try a different search term</p>
                  </div>
                )}
              </div>
            )}

            {/* Instructions when no search */}
            {!showResults && (
              <div className="text-center py-6 text-muted-foreground">
                <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Start typing to search products</p>
              </div>
            )}
          </CardContent>
        </Card>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
