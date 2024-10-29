import { useState } from "react";
import { Heart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useStoreContext } from "@/contexts/StoreContext";
import { Link } from "@tanstack/react-router";
import placeholder from "@/assets/placeholder.png";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { ProductSku } from "@athena/webapp-2";
import { capitalizeWords } from "@/lib/utils";

export default function ShoppingBag() {
  const { formatter } = useStoreContext();
  const { bag, deleteItemFromBag, updateBag, isUpdatingBag } = useShoppingBag();

  const subtotal =
    bag?.items.reduce(
      (sum: number, item: ProductSku) => sum + item.price * item.quantity,
      0
    ) || 0;
  const shipping = 5.99;
  const total = subtotal + shipping;

  const getProductName = (item: ProductSku) => {
    if (item.productCategory == "Wigs") {
      return `${item.length}'' ${capitalizeWords(item.colorName)} ${item.productName}`;
    }

    return item.productName;
  };

  if (bag?.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <h1 className="text-2xl font-bold mb-4">Your shopping bag is empty</h1>
        <Link to="/">
          <Button>Continue Shopping</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-8">Shopping Bag</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-16">
          {bag?.items.map((item: ProductSku) => (
            <div key={item.id} className="flex items-center space-x-4">
              <Link
                key={item.id}
                to={"/shop/product/$productSlug"}
                params={() => ({ productSlug: item.productId })}
                search={{
                  variant: item.productSku,
                }}
              >
                <img
                  src={item.productImage || placeholder}
                  alt={item.productName || "product image"}
                  className="w-40 h-40 object-cover rounded-lg"
                />
              </Link>
              <div className="flex-1 space-y-6">
                <div className="flex flex-col ml-2">
                  <h2 className="text-lg font-semibold">
                    {getProductName(item)}
                  </h2>
                  <select
                    value={item.quantity}
                    onChange={(e) =>
                      updateBag({
                        quantity: parseInt(e.target.value),
                        itemId: item._id,
                      })
                    }
                    disabled={isUpdatingBag}
                    className="w-12 py-2 bg-white text-black"
                  >
                    {[...Array(10)].map((_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i + 1}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2">
                  <Button variant="ghost" size="icon" disabled={isUpdatingBag}>
                    <Heart className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={isUpdatingBag}
                    onClick={() => deleteItemFromBag(item._id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="text-lg font-semibold">
                {formatter.format(item.price * item.quantity)}
              </p>
            </div>
          ))}
        </div>
        <div>
          <div className="bg-gray-50 p-6 rounded-lg sticky top-4">
            <h2 className="text-xl font-semibold mb-4">Order Summary</h2>
            <div className="flex justify-between mb-2">
              <span>Subtotal</span>
              <span>{formatter.format(subtotal)}</span>
            </div>
            <div className="flex justify-between mb-2">
              <span>Shipping</span>
              <span>{formatter.format(shipping)}</span>
            </div>
            <Separator className="my-4" />
            <div className="flex justify-between text-lg font-semibold">
              <span>Total</span>
              <span>{formatter.format(total)}</span>
            </div>
            <Button className="w-full mt-6">Proceed to Checkout</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
