import { useState } from "react";
import { ShoppingBasket, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { Link } from "@tanstack/react-router";
import placeholder from "@/assets/placeholder.png";
import { ShoppingBagAction, useShoppingBag } from "@/hooks/useShoppingBag";
import { ProductSku } from "@athena/webapp-2";
import { capitalizeWords } from "@/lib/utils";
import { AnimatePresence, easeInOut, motion } from "framer-motion";
import { EmptyState } from "../states/empty/empty-state";
import { FadeIn } from "../common/FadeIn";

export default function SavedBag() {
  const [bagAction, setBagAction] = useState<ShoppingBagAction>("idle");
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

  const cellVariants = {
    exit: (bagAction: ShoppingBagAction) => ({
      opacity: 0,
      x: bagAction == "deleting-from-saved-bag" ? 0 : 24,
    }),
  };

  const backgroundSvgVariants = {
    exit: (bagAction: ShoppingBagAction) => ({
      opacity: 0,
      x: bagAction == "deleting-from-saved-bag" ? 0 : 24,
    }),
  };

  return (
    <FadeIn className="container mx-auto space-y-24 px-4 py-16">
      {<h1 className="text-2xl font-light mb-8">Saved</h1>}

      {isSavedEmpty && <EmptyState message="You don't have any saved items." />}

      {!isSavedEmpty && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-40">
          <div className="md:col-span-2 space-y-16">
            <AnimatePresence initial={false} custom={bagAction}>
              {savedBag?.items.map((item: ProductSku, index: number) => (
                <motion.div
                  key={item._id}
                  layout
                  className="relative flex items-center space-x-4"
                >
                  <motion.div
                    className="absolute inset-0 flex px-16 items-center pointer-events-none"
                    variants={backgroundSvgVariants}
                    exit={"exit"}
                    transition={{ duration: 0.4, delay: 0.1 }}
                  >
                    {bagAction == "deleting-from-saved-bag" ? (
                      <Trash2 className="text-gray-300 w-16 h-16" />
                    ) : (
                      <ShoppingBasket className="text-gray-300 w-16 h-16" />
                    )}
                  </motion.div>

                  <motion.div
                    variants={cellVariants}
                    exit={"exit"}
                    custom={bagAction}
                    className="relative z-10 flex gap-4 items-center"
                  >
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
                        className="w-48 h-48 object-cover rounded-lg"
                      />
                    </Link>

                    <div className="flex-1 space-y-6 text-sm">
                      <div className="flex flex-col ml-2 gap-4">
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
                          onClick={() => {
                            setBagAction("moving-to-bag");
                            moveItemFromSavedToBag(item);
                          }}
                        >
                          <ShoppingBasket className="h-4 w-4" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isUpdatingSavedBag}
                          onClick={() => {
                            setBagAction("deleting-from-saved-bag");
                            deleteItemFromSavedBag(item._id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </FadeIn>
  );
}
