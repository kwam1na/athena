import { useState } from "react";
import { ArrowRight, Heart, InfoIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { Link, useNavigate } from "@tanstack/react-router";
import placeholder from "@/assets/placeholder.png";
import { ShoppingBagAction, useShoppingBag } from "@/hooks/useShoppingBag";
import { ProductSku } from "@athena/webapp-2";
import { getProductName } from "@/lib/utils";
import { motion, AnimatePresence, easeInOut } from "framer-motion";
import { HeartIconFilled } from "@/assets/icons/HeartIconFilled";
import { useQueryClient } from "@tanstack/react-query";
import { LoadingButton } from "../ui/loading-button";

export default function ShoppingBag() {
  const [bagAction, setBagAction] = useState<ShoppingBagAction>("idle");
  const { formatter, userId, isNavbarShowing } = useStoreContext();
  const {
    bag,
    deleteItemFromBag,
    updateBag,
    isUpdatingBag,
    moveItemFromBagToSaved,
    obtainCheckoutSession,
    unavailableProducts,
    areProductsUnavailable,
  } = useShoppingBag();

  const [isProcessingCheckoutRequest, setIsProcessingCheckoutRequest] =
    useState(false);

  const navigate = useNavigate();

  const queryClient = useQueryClient();

  const subtotal =
    bag?.items.reduce(
      (sum: number, item: ProductSku) =>
        sum + (item.price || 0) * item.quantity,
      0
    ) || 0;
  const total = subtotal;

  const isBagEmpty = bag?.items.length === 0;

  const cellVariants = {
    exit: (bagAction: ShoppingBagAction) => ({
      opacity: 0,
      x: bagAction == "deleting-from-bag" ? 0 : -24,
    }),
  };

  const backgroundSvgVariants = {
    exit: (bagAction: ShoppingBagAction) => ({
      opacity: 0,
      x: bagAction == "deleting-from-bag" ? 0 : -24,
    }),
  };

  const handleOnCheckoutClick = async () => {
    // send post
    const bagItems = bag.items.map((item: any) => ({
      productSkuId: item.productSkuId,
      quantity: item.quantity,
      productSku: item.productSku,
      productId: item.productId,
    }));

    setIsProcessingCheckoutRequest(true);

    const res = await obtainCheckoutSession({ bagItems, bagId: bag._id });

    if (res.session) {
      queryClient.setQueryData(["active-checkout-session", userId], {
        session: res.session,
      });
      navigate({
        to: "/shop/checkout",
      });
    } else {
      setIsProcessingCheckoutRequest(false);
    }
  };

  const isSkuUnavailable = (skuId: string) => {
    return unavailableProducts.find((p) => p.productSkuId == skuId);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {!isBagEmpty && <h1 className="text-2xl font-light mb-8">Bag</h1>}

      <AnimatePresence initial={false}>
        {isBagEmpty && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ease: easeInOut }}
            className="flex flex-col items-center mt-40 lg:items-start gap-16 lg:mt-12 lg:min-h-[50vh]"
          >
            <p className="text-sm">You don't have any items in your bag.</p>
            <Link to="/">
              <Button className="w-[320px]">Continue Shopping</Button>
            </Link>
          </motion.div>
        )}
      </AnimatePresence>

      {!isBagEmpty && total !== 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-40">
          <div className="md:col-span-2 space-y-16">
            <AnimatePresence initial={false} custom={bagAction}>
              {bag?.items.map((item: ProductSku, index: number) => {
                const unavailableSku = isSkuUnavailable(item.productSkuId);

                return (
                  <motion.div
                    key={item._id}
                    layout
                    className="relative flex items-center space-x-4"
                  >
                    {/* Larger Heart SVG behind */}
                    <motion.div
                      className="absolute inset-0 flex px-16 items-center pointer-events-none"
                      variants={backgroundSvgVariants}
                      exit={"exit"}
                      transition={{ duration: 0.4, delay: 0.1 }}
                    >
                      {bagAction == "deleting-from-bag" ? (
                        <Trash2 className="text-gray-300 w-16 h-16" />
                      ) : (
                        <HeartIconFilled width={56} height={56} />
                      )}
                    </motion.div>

                    {/* Bag Content */}
                    <motion.div
                      exit="exit"
                      variants={cellVariants}
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
                              updateBag({
                                quantity: parseInt(e.target.value),
                                itemId: item._id,
                              })
                            }
                            disabled={isUpdatingBag || !item.price}
                            className="w-12 py-2 bg-white text-black"
                          >
                            {[...Array(10)].map((_, i) => (
                              <option key={i + 1} value={i + 1}>
                                {i + 1}
                              </option>
                            ))}
                          </select>

                          {unavailableSku && (
                            <p className="text-xs text-destructive">
                              {unavailableSku.available === 0
                                ? "Currently unavailable"
                                : `Only ${unavailableSku.available} left`}
                            </p>
                          )}
                        </div>

                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={isUpdatingBag || !item.price}
                            onClick={() => {
                              setBagAction("moving-to-saved-bag");
                              moveItemFromBagToSaved(item);
                            }}
                          >
                            <Heart className="h-4 w-4" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={isUpdatingBag}
                            onClick={() => {
                              setBagAction("deleting-from-bag");
                              deleteItemFromBag(item._id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {/* Cart Summary */}
          <div className="hidden md:block relative">
            <div className="p-6 space-y-16 rounded-lg sticky top-8">
              <div className="space-y-4">
                <div className="flex justify-between mb-2">
                  <span>Subtotal</span>
                  <span>{formatter.format(subtotal)}</span>
                </div>
                <div className="flex justify-between mb-2">
                  <span>Shipping</span>
                  <span>Calculated at checkout</span>
                </div>
              </div>
              <div className="flex justify-between text-lg font-semibold">
                <span>Total</span>
                <span>{formatter.format(total)}</span>
              </div>
              <div className="space-y-8">
                {areProductsUnavailable && (
                  <div className="flex">
                    <InfoIcon className="w-4 h-4 mr-2" />
                    <p className="text-xs">
                      Some items are no longer available. Update your bag to
                      continue.
                    </p>
                  </div>
                )}
                <LoadingButton
                  isLoading={isProcessingCheckoutRequest}
                  onClick={handleOnCheckoutClick}
                  className="w-full"
                >
                  Checkout
                </LoadingButton>
              </div>
            </div>
          </div>

          {/* Mobile Cart Summary */}
          {isNavbarShowing && (
            <div className="block md:hidden absolute bottom-0 left-0 w-full bg-white p-6 shadow-md">
              <div className="flex justify-between text-lg font-semibold mb-4">
                <span>Total</span>
                <span>{formatter.format(total)}</span>
              </div>
              <div className="space-y-8">
                {areProductsUnavailable && (
                  <div className="flex">
                    <InfoIcon className="w-4 h-4 mr-2" />
                    <p className="text-xs">
                      Some items are no longer available. Update your bag to
                      continue.
                    </p>
                  </div>
                )}
                <LoadingButton
                  isLoading={isProcessingCheckoutRequest}
                  onClick={handleOnCheckoutClick}
                  className="w-full"
                >
                  Checkout
                </LoadingButton>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
