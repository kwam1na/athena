import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Minus, Package, Plus, ShoppingCart } from "lucide-react";
import { Product } from "./types";
import { capitalizeWords } from "~/src/lib/utils";
import { toDisplayAmount } from "~/convex/lib/currency";
import { useEffect, useMemo, useState } from "react";

interface ProductCardProps {
  product: Product;
  onAddProduct: (
    product: Product,
    quantity?: number,
  ) => boolean | Promise<boolean>;
  formatter: Intl.NumberFormat;
  onAfterAdd?: () => void;
}

function normalizeQuantity(value: string | number, maxQuantity?: number) {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  const quantity = Math.max(1, Math.trunc(parsed));
  if (maxQuantity === undefined || maxQuantity <= 0) {
    return quantity;
  }

  return Math.min(quantity, maxQuantity);
}

export function ProductCard({
  product,
  onAddProduct,
  formatter,
  onAfterAdd,
}: ProductCardProps) {
  const [quantityInput, setQuantityInput] = useState("1");
  const maxQuantity = useMemo(() => {
    if (typeof product.quantityAvailable !== "number") {
      return undefined;
    }

    return Math.max(0, Math.trunc(product.quantityAvailable));
  }, [product.quantityAvailable]);
  const selectedQuantity = normalizeQuantity(quantityInput, maxQuantity);
  const isAvailable =
    product.inStock && (maxQuantity === undefined || maxQuantity > 0);
  const canDecreaseQuantity = selectedQuantity > 1;
  const canIncreaseQuantity =
    maxQuantity === undefined || selectedQuantity < maxQuantity;

  useEffect(() => {
    setQuantityInput("1");
  }, [product.id]);

  const handleAddSelectedQuantity = async () => {
    if (isAvailable) {
      setQuantityInput(String(selectedQuantity));
      const added = await onAddProduct(product, selectedQuantity);
      if (added !== false) {
        onAfterAdd?.();
      }
    }
  };

  return (
    <div
      aria-disabled={!isAvailable}
      className={`group flex flex-col gap-4 rounded-lg border p-4 transition-all duration-200 sm:flex-row sm:items-center ${
        !isAvailable
          ? "cursor-not-allowed border-border/70 bg-surface/80 opacity-95"
          : "border-border bg-surface/80 hover:border-signal/30 hover:shadow-surface"
      }`}
      onClick={handleAddSelectedQuantity}
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
      <div className="min-w-0 flex-1">
        {/* Name and Price */}
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-md truncate font-semibold text-foreground/80 group-hover:text-foreground">
            {capitalizeWords(product.name)}
          </h4>
          <div className="flex items-center gap-2 flex-shrink-0">
            <p className="px-4 font-numeric text-lg font-medium">
              {formatter.format(toDisplayAmount(product.price))}
            </p>
          </div>
        </div>

        {/* SKU and Barcode */}
        <div className="flex items-center gap-2 mt-1">
          {product.sku && (
            <span className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
              {product.sku}
            </span>
          )}
          {product.barcode && (
            <span className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
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

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          {/* Availability */}
          <p className="text-xs text-muted-foreground">
            {product.availabilityMessage ? (
              product.availabilityMessage
            ) : (
              <>
                <b>{product.quantityAvailable ?? 0}</b> available
              </>
            )}
          </p>

          <div
            className="flex items-center rounded-md border border-border bg-background p-1.5 shadow-sm"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-11 w-11 rounded-md"
                disabled={!isAvailable || !canDecreaseQuantity}
                aria-label={`Decrease quantity for ${product.name}`}
                onClick={() =>
                  setQuantityInput(String(Math.max(1, selectedQuantity - 1)))
                }
              >
                <Minus className="h-4 w-4" />
              </Button>
              <label className="sr-only" htmlFor={`quantity-${product.id}`}>
                Quantity for {product.name}
              </label>
              <Input
                id={`quantity-${product.id}`}
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                min={1}
                max={maxQuantity}
                value={quantityInput}
                disabled={!isAvailable}
                className="h-11 w-14 px-2 text-center font-numeric text-base font-semibold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                onBlur={() => setQuantityInput(String(selectedQuantity))}
                onChange={(event) => setQuantityInput(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-11 w-11 rounded-md"
                disabled={!isAvailable || !canIncreaseQuantity}
                aria-label={`Increase quantity for ${product.name}`}
                onClick={() => setQuantityInput(String(selectedQuantity + 1))}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="ml-3 flex border-l border-border/80 pl-3">
              <Button
                type="button"
                size="sm"
                className="h-11 px-4"
                disabled={!isAvailable}
                onClick={handleAddSelectedQuantity}
              >
                <ShoppingCart className="mr-1.5 h-4 w-4" />
                <span>
                  Add{selectedQuantity > 1 ? ` ${selectedQuantity}` : ""}
                </span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
