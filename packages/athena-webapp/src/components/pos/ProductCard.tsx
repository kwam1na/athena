import { Badge } from "@/components/ui/badge";
import { Package } from "lucide-react";
import { Product } from "./types";
import { capitalizeWords } from "~/src/lib/utils";
import { toDisplayAmount } from "~/convex/lib/currency";

interface ProductCardProps {
  product: Product;
  onAddProduct: (product: Product) => void;
  formatter: Intl.NumberFormat;
  onAfterAdd?: () => void;
}

export function ProductCard({
  product,
  onAddProduct,
  formatter,
  onAfterAdd,
}: ProductCardProps) {
  const isAvailable = product.inStock;
  const handleClick = () => {
    if (isAvailable) {
      onAddProduct(product);
      onAfterAdd?.();
    }
  };

  return (
    <div
      aria-disabled={!isAvailable}
      className={`group flex items-center gap-4 p-4 border rounded-lg transition-all duration-200 bg-white/80 backdrop-blur-sm ${
        !isAvailable
          ? "cursor-not-allowed opacity-95 border-gray-200"
          : "border-gray-200 hover:border-blue-200 hover:shadow-md hover:shadow-blue-100/50"
      }`}
      onClick={handleClick}
    >
      {/* Product Image */}
      <div className="w-16 h-16 bg-muted rounded flex items-center justify-center flex-shrink-0 overflow-hidden">
        {product.image ? (
          <img
            src={product.image}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <Package className="w-5 h-5 text-muted-foreground" />
        )}
      </div>

      {/* Product Details */}
      <div className="flex-1 min-w-0">
        {/* Name and Price */}
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-semibold text-md text-gray-600 truncate group-hover:text-gray-900">
            {capitalizeWords(product.name)}
          </h4>
          <div className="flex items-center gap-2 flex-shrink-0">
            <p className="text-lg font-medium px-4">
              {formatter.format(toDisplayAmount(product.price))}
            </p>
          </div>
        </div>

        {/* SKU and Barcode */}
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

        {/* Category, Size, Length */}
        {(product.size || product.length || product.category) && (
          <div className="flex items-center gap-2 mt-2">
            {product.color && (
              <Badge variant="outline" className="text-xs">
                {capitalizeWords(product.color)}
              </Badge>
            )}
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

        {/* Availability */}
        <p className="text-xs text-gray-500 mt-4">
          {product.availabilityMessage ? (
            product.availabilityMessage
          ) : (
            <>
              <b>{product.quantityAvailable ?? 0}</b> available
            </>
          )}
        </p>
      </div>
    </div>
  );
}
