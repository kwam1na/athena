import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import * as Collapsible from "@radix-ui/react-collapsible";
import { Search, Plus, Package } from "lucide-react";
import { Product } from "./types";
import { usePOSProductSearch } from "@/hooks/usePOSProducts";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { currencyFormatter } from "~/convex/utils";

interface ProductLookupProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onAddProduct: (product: Product) => void;
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
                  <div className="text-center py-6 text-muted-foreground">
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-sm">Searching products...</p>
                  </div>
                ) : filteredProducts.length > 0 ? (
                  <div className="space-y-2">
                    {filteredProducts.slice(0, 10).map((product) => (
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
                              {formatter.format(product.price)}
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
                    {filteredProducts.length > 10 && (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        Showing first 10 results. Type more to narrow down.
                      </p>
                    )}
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
