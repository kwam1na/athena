import { useState } from "react";
import { ShoppingBasket, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { Link } from "@tanstack/react-router";
import placeholder from "@/assets/placeholder.png";
import { ShoppingBagAction, useShoppingBag } from "@/hooks/useShoppingBag";
import { ProductSku, SavedBagItem } from "@athena/webapp";
import { capitalizeWords, getProductName } from "@/lib/utils";
import { AnimatePresence, easeInOut, motion } from "framer-motion";
import { EmptyState } from "../states/empty/empty-state";
import { FadeIn } from "../common/FadeIn";
import ImageWithFallback from "../ui/image-with-fallback";
import { postAnalytics } from "@/api/analytics";

export default function SavedBag() {
  const [bagAction, setBagAction] = useState<ShoppingBagAction>("idle");
  const { formatter, isNavbarShowing } = useStoreContext();
  const {
    savedBag,
    deleteItemFromSavedBag,
    updateSavedBag,
    isUpdatingSavedBag,
    moveItemFromSavedToBag,
  } = useShoppingBag();

  // const getProductName = (item: ProductSku) => {
  //   if ((item as any).productCategory == "Hair") {
  //     if (!(item as any).colorName) return capitalizeWords((item as any).productName);
  //     return `${item.length}" ${capitalizeWords((item as any).colorName)} ${(item as any).productName}`;
  //   }

  //   return (item as any).productName;
  // };

  const isSavedEmpty = savedBag?.items?.length === 0;

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
    <FadeIn className="container mx-auto max-w-[1024px] min-h-screen px-6 xl:px-0 space-y-8 lg:space-y-24 py-8">
      {!isSavedEmpty && <h1 className="text-lg font-light mb-8">Saved</h1>}

      {isSavedEmpty && (
        <EmptyState
          message="Nothing saved yet. Spot something you love?"
          cta="Browse Bestsellers"
          ctaDestination="/shop/best-sellers"
        />
      )}

      {!isSavedEmpty && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-40">
          <div className="md:col-span-2 space-y-24">
            <AnimatePresence initial={false} custom={bagAction}>
              {savedBag?.items?.map((item: SavedBagItem, index: number) => (
                <motion.div
                  key={item._id}
                  layout={isNavbarShowing}
                  className="relative flex space-x-4"
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
                    className="relative z-10 flex gap-8 items-center"
                  >
                    <Link
                      key={index}
                      to={"/shop/product/$productSlug"}
                      params={() => ({ productSlug: item.productId })}
                      search={{
                        variant: item.productSku,
                      }}
                    >
                      <ImageWithFallback
                        src={(item as any).productImage || placeholder}
                        alt={(item as any).productName || "product image"}
                        className="w-32 h-32 lg:w-40 lg:h-40 object-cover rounded-lg"
                      />
                    </Link>

                    <div className="flex-1 space-y-2 lg:space-y-6 text-sm">
                      <div className="flex flex-col ml-2 gap-2 lg:gap-4">
                        <h2 className="font-medium">
                          {item && getProductName(item)}
                        </h2>
                        <p className="text-xs text-muted-foreground">
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
                          className="w-12 py-2 bg-background text-xs"
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
                          onClick={async () => {
                            setBagAction("moving-to-bag");
                            await Promise.all([
                              moveItemFromSavedToBag(item),
                              postAnalytics({
                                action: "added_product_to_bag",
                                origin: "saved_bag",
                                data: {
                                  product: item.productId,
                                  productSku: item.productSku,
                                  productImageUrl: item.productImage,
                                },
                              }),
                            ]);
                          }}
                        >
                          <ShoppingBasket className="h-4 w-4" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isUpdatingSavedBag}
                          onClick={async () => {
                            setBagAction("deleting-from-saved-bag");
                            await Promise.all([
                              deleteItemFromSavedBag(item._id),
                              postAnalytics({
                                action: "removed_product_from_saved",
                                data: {
                                  product: item.productId,
                                  productSku: item.productSku,
                                  productImageUrl: item.productImage,
                                },
                              }),
                            ]);
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
