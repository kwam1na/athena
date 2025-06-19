import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingCart, Trash2, Plus, Minus } from "lucide-react";
import { CartItem } from "./types";
import { currencyFormatter } from "~/convex/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { capitalizeWords } from "~/src/lib/utils";

interface CartItemsProps {
  cartItems: CartItem[];
  onUpdateQuantity: (id: string, newQuantity: number) => void;
  onRemoveItem: (id: string) => void;
}

export function CartItems({
  cartItems,
  onUpdateQuantity,
  onRemoveItem,
}: CartItemsProps) {
  const { activeStore } = useGetActiveStore();
  const formatter = currencyFormatter(activeStore?.currency || "GHS");

  return (
    <Card className="flex-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <ShoppingCart className="w-4 h-4" />
          Items ({cartItems.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {cartItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <ShoppingCart className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <div className="space-y-1">
              <p className="text-sm">No items in cart</p>
              {/* <p className="text-sm">Scan or enter a barcode to add items</p> */}
            </div>
          </div>
        ) : (
          <div className="space-y-4 overflow-y-auto">
            {cartItems.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-12 gap-2 p-3 border rounded-lg items-center"
              >
                {/* Product Image & Info Combined */}
                <div className="col-span-5 flex items-center gap-4">
                  <div className="w-12 h-12 bg-muted rounded flex items-center justify-center flex-shrink-0">
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-full h-full object-cover rounded"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">IMG</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <h4 className="font-medium text-sm leading-tight truncate">
                      {capitalizeWords(item.name)}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {item.barcode}
                    </p>
                    {(item.size || item.length) && (
                      <p className="text-xs text-muted-foreground">
                        {item.size && `Size: ${item.size}`}
                        {item.size && item.length && " • "}
                        {item.length && `Length: ${item.length}"`}
                      </p>
                    )}
                    <p className="text-sm font-medium">
                      {formatter.format(item.price)} each
                    </p>
                  </div>
                </div>

                {/* Quantity Controls */}
                <div className="col-span-4 flex items-center justify-center">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() =>
                        onUpdateQuantity(item.id, item.quantity - 1)
                      }
                    >
                      <Minus className="w-4 h-4" />
                    </Button>
                    <span className="w-10 text-center font-medium text-sm">
                      {item.quantity}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() =>
                        onUpdateQuantity(item.id, item.quantity + 1)
                      }
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Total Price */}
                <div className="col-span-2 text-right">
                  <p className="font-semibold text-sm">
                    {formatter.format(item.price * item.quantity)}
                  </p>
                </div>

                {/* Remove Button */}
                <div className="col-span-1 flex justify-center">
                  <Button
                    variant="ghost"
                    size="default"
                    className="h-9 w-9 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => onRemoveItem(item.id)}
                  >
                    <Trash2 className="w-5 h-5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
