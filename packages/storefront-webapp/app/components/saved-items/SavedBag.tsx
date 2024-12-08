import { useState } from "react";
import { Heart, ShoppingBasket, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { Link } from "@tanstack/react-router";
import placeholder from "@/assets/placeholder.png";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { ProductSku } from "@athena/webapp-2";
import { capitalizeWords } from "@/lib/utils";

export default function SavedBag() {
  const { formatter } = useStoreContext();
  const {
    savedBag,
    deleteItemFromSavedBag,
    updateSavedBag,
    isUpdatingSavedBag,
    moveItemFromSavedToBag,
  } = useShoppingBag();

  const getProductName = (item: ProductSku) => {
    if (item.productCategory == "Hair") {
      if (!item.colorName) return capitalizeWords(item.productName);
      return `${item.length}" ${capitalizeWords(item.colorName)} ${item.productName}`;
    }

    return item.productName;
  };

  const isSavedEmpty = savedBag?.items.length === 0;

  return (
    <div className="container mx-auto px-4 py-8">
      {!isSavedEmpty && <h1 className="text-2xl font-light mb-8">Saved</h1>}

      {isSavedEmpty && (
        <div className="flex flex-col items-center mt-40 lg:items-start gap-16 lg:mt-12 lg:min-h-[50vh]">
          <p className="text-sm">You don't have any saved items.</p>
          <Link to="/">
            <Button className="w-[320px]">Continue Shopping</Button>
          </Link>
        </div>
      )}

      {!isSavedEmpty && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-40">
          <div className="md:col-span-2 space-y-16">
            {savedBag?.items.map((item: ProductSku, index: number) => (
              <div key={index} className="flex items-center space-x-4">
                <Link
                  key={index}
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
                  <div className="flex flex-col ml-2 gap-2">
                    <h2>{item && getProductName(item)}</h2>
                    <p className="text-sm text-muted-foreground">
                      {item.price
                        ? formatter.format(item.price * item.quantity)
                        : "Product unavailable"}
                    </p>
                    <select
                      value={item.quantity}
                      onChange={(e) =>
                        updateSavedBag({
                          quantity: parseInt(e.target.value),
                          itemId: item._id,
                        })
                      }
                      disabled={isUpdatingSavedBag || !item.price}
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
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={isUpdatingSavedBag || !item.price}
                      onClick={() => moveItemFromSavedToBag(item)}
                    >
                      <ShoppingBasket className="h-4 w-4" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={isUpdatingSavedBag}
                      onClick={() => deleteItemFromSavedBag(item._id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
