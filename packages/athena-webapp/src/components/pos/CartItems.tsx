import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  ShoppingBasket,
  ShoppingBag,
  Package,
} from "lucide-react";
import { CartItem } from "./types";
import { currencyFormatter } from "~/convex/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { capitalizeWords, cn } from "~/src/lib/utils";
import { Id } from "~/convex/_generated/dataModel";
import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";

interface CartItemsProps {
  cartItems: CartItem[];
  onUpdateQuantity?: (
    id: Id<"posSessionItem"> | Id<"expenseSessionItem">,
    newQuantity: number,
  ) => void;
  onRemoveItem?: (id: Id<"posSessionItem"> | Id<"expenseSessionItem">) => void;
  clearCart?: () => void;
  readOnly?: boolean;
  density?: "comfortable" | "compact";
  className?: string;
}

export function CartItems({
  cartItems,
  onUpdateQuantity,
  onRemoveItem,
  clearCart,
  readOnly = false,
  density = "comfortable",
  className,
}: CartItemsProps) {
  const { activeStore } = useGetActiveStore();
  const formatter = currencyFormatter(activeStore?.currency || "GHS");
  const isCompact = density === "compact";

  // Compute total quantity once
  const totalQuantity = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50/50 to-gray-100/30",
        isCompact && "min-h-72 basis-0",
        className,
      )}
    >
      {totalQuantity > 0 && (
        <CardHeader
          className={cn(
            "flex shrink-0 flex-row items-center justify-between",
            isCompact && "px-4 py-3",
          )}
        >
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <ShoppingBasket className="w-4 h-4" />
            Items · {totalQuantity}
          </CardTitle>
          {!readOnly && clearCart && (
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "border-none bg-transparent text-red-500 hover:bg-red-50 hover:text-red-500",
                isCompact ? "h-10 px-3" : "p-8",
              )}
              onClick={clearCart}
            >
              <Trash2 className="w-4 h-4" />
              {!isCompact && "Clear all"}
            </Button>
          )}
        </CardHeader>
      )}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden p-4 pb-6",
          isCompact && "flex-1 pt-0",
        )}
      >
        {cartItems.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <ShoppingBasket className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <div className="space-y-1">
              <p className="text-sm">No items</p>
              {/* <p className="text-sm">Scan or enter a barcode to add items</p> */}
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 pb-4",
              isCompact && "h-full",
            )}
          >
            {cartItems.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "border bg-white rounded-lg",
                  isCompact
                    ? "space-y-3 p-3"
                    : "grid grid-cols-12 gap-2 p-8 items-center",
                )}
              >
                {/* Product Image & Info Combined */}
                <div
                  className={cn(
                    "flex items-start gap-4",
                    !isCompact && "col-span-5",
                  )}
                >
                  <div className="relative">
                    <div
                      className={cn(
                        "bg-muted rounded flex items-center justify-center flex-shrink-0",
                        isCompact ? "w-12 h-12" : "w-16 h-16",
                      )}
                    >
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-full h-full object-cover rounded"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          <Package className="w-5 h-5" />
                        </span>
                      )}
                    </div>
                    {readOnly && <div className="absolute -top-2 -left-2 bg-muted text-primary-background text-xs w-5 h-5 rounded-full flex items-center justify-center shadow-sm">
                      {item.quantity}
                    </div>}
                  </div>

                  <div
                    className={cn(
                      "flex min-w-0 flex-1",
                      isCompact
                        ? "items-start justify-between gap-3"
                        : "block space-y-2",
                    )}
                  >
                    <div className="min-w-0 space-y-2">
                      <h4 className="font-medium text-sm leading-tight truncate">
                        {capitalizeWords(item.name)}
                      </h4>

                      <div className="flex items-center gap-1">
                        {item.sku && (
                          <p className="truncate text-xs text-muted-foreground">
                            {item.sku}
                          </p>
                        )}
                        {item.sku && item.barcode && (
                          <p className="text-xs text-muted-foreground">•</p>
                        )}
                        {item.barcode && (
                          <p className="truncate text-xs text-muted-foreground">
                            {item.barcode}
                          </p>
                        )}
                      </div>

                      {(item.size || item.length || item.color) && (
                        <p className="text-xs text-muted-foreground capitalize">
                          {item.length && `${item.length}"`}
                          {item.size && item.length && " • "}
                          {item.size && `${item.size}`}
                          {item.color && (item.size || item.length) && " • "}
                          {item.color && capitalizeWords(item.color)}
                        </p>
                      )}

                      <p
                        className={cn(
                          "text-sm font-medium",
                          !isCompact && "pt-2",
                        )}
                      >
                        {formatStoredAmount(formatter, item.price)}
                      </p>
                    </div>

                    {isCompact && (
                      <p className="shrink-0 text-right text-sm font-semibold">
                        {formatStoredAmount(
                          formatter,
                          item.price * item.quantity,
                        )}
                      </p>
                    )}
                  </div>
                </div>

                <div
                  className={cn(
                    "flex items-center",
                    isCompact ? "justify-between pt-3" : "contents",
                  )}
                >
                  {/* Quantity Controls */}
                  <div
                    className={cn(
                      "flex items-center",
                      isCompact ? "justify-start" : "col-span-4 justify-center",
                    )}
                  >
                    {!readOnly && <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10"
                        onClick={() =>
                          onUpdateQuantity &&
                          onUpdateQuantity(
                            item.id as
                            | Id<"posSessionItem">
                            | Id<"expenseSessionItem">,
                            item.quantity - 1,
                          )
                        }
                      >
                        <Minus className="w-4 h-4" />
                      </Button>
                      <span className="w-10 text-center font-medium text-sm">
                        {item.quantity}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10"
                        onClick={() =>
                          onUpdateQuantity &&
                          onUpdateQuantity(
                            item.id as
                            | Id<"posSessionItem">
                            | Id<"expenseSessionItem">,
                            item.quantity + 1,
                          )
                        }
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>}
                  </div>

                  <div
                    className={cn(
                      "text-right",
                      isCompact && "hidden",
                      !isCompact && "col-span-2",
                    )}
                  >
                    <p className="font-semibold text-sm">
                      {formatStoredAmount(
                        formatter,
                        item.price * item.quantity,
                      )}
                    </p>
                  </div>

                  {!readOnly && onRemoveItem && (
                    <div
                      className={cn(
                        "flex justify-center",
                        !isCompact && "col-span-1",
                      )}
                    >
                      <Button
                        variant="ghost"
                        size="default"
                        className={cn(
                          "text-destructive hover:text-destructive hover:bg-destructive/10",
                          isCompact ? "h-10 w-10 p-0" : "h-10 w-10 p-8",
                        )}
                        onClick={() =>
                          onRemoveItem &&
                          onRemoveItem(
                            item.id as
                            | Id<"posSessionItem">
                            | Id<"expenseSessionItem">,
                          )
                        }
                      >
                        <Trash2
                          className={cn(isCompact ? "w-4 h-4" : "w-5 h-5")}
                        />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
