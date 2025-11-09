import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import { Product } from "./types";
import { ProductCard } from "./ProductCard";

interface SearchResultsSectionProps {
  isLoading: boolean;
  products: Product[];
  onAddProduct: (product: Product) => void;
  formatter: Intl.NumberFormat;
  onClearSearch: () => void;
}

export function SearchResultsSection({
  isLoading,
  products,
  onAddProduct,
  formatter,
  onClearSearch,
}: SearchResultsSectionProps) {
  //   if (isLoading) {
  //     return (
  //       <div className="max-h-[586px] overflow-y-auto space-y-1">
  //         <div className="text-center py-8 text-gray-500">
  //           {/* <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" /> */}
  //           {/* <p className="text-sm font-medium">Searching products...</p> */}
  //         </div>
  //       </div>
  //     );
  //   }

  if (products.length === 0) {
    return (
      <div className="max-h-[586px] overflow-y-auto space-y-1">
        <div className="text-center py-8 text-gray-500">
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Search className="w-6 h-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium">No products found</p>
          <p className="text-xs text-gray-400 mt-1">
            Try a different search term or check spelling
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-h-[586px] overflow-y-auto space-y-1">
      <div className="space-y-8 py-8">
        {products.slice(0, 10).map((product: Product) => (
          <ProductCard
            key={product.id}
            product={product}
            onAddProduct={onAddProduct}
            formatter={formatter}
            onAfterAdd={onClearSearch}
          />
        ))}
        {products.length > 10 && (
          <div className="text-center py-3">
            <Badge variant="secondary" className="text-xs">
              Showing first 10 results • Type more to narrow down
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}
