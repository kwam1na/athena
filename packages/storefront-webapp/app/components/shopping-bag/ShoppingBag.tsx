import { useState } from "react";
import { Heart, Info, InfoIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { Link, useNavigate } from "@tanstack/react-router";
import placeholder from "@/assets/placeholder.png";
import { ShoppingBagAction, useShoppingBag } from "@/hooks/useShoppingBag";
import { ProductSku } from "@athena/webapp-2";
import { getProductName } from "@/lib/utils";
import { motion, AnimatePresence, easeInOut } from "framer-motion";
import { HeartIconFilled } from "@/assets/icons/HeartIconFilled";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoadingButton } from "../ui/loading-button";
import { EmptyState } from "../states/empty/empty-state";
import { FadeIn } from "../common/FadeIn";
import { checkoutSessionQueries } from "@/queries";
import { ArrowRightIcon } from "@radix-ui/react-icons";

const PendingItem = ({ session }: { session: any }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0, transition: { ease: easeInOut } }}
      className="flex items-center"
    >
      <InfoIcon className="w-4 h-4" />
      <Link
        to="/shop/checkout/$sessionIdSlug"
        params={{ sessionIdSlug: session._id }}
        className="flex items-center"
      >
        <Button variant={"link"}>
          <p className="text-xs underline">You have a pending order</p>
        </Button>
        <ArrowRightIcon className="w-4 h-4" />
      </Link>
    </motion.div>
  );
};

export default function ShoppingBag() {
  const [bagAction, setBagAction] = useState<ShoppingBagAction>("idle");
  const { formatter, userId, organizationId, storeId, isNavbarShowing } =
    useStoreContext();
  const {
    bag,
    bagSubtotal,
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

  const total = bagSubtotal;

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

  const { data } = useQuery(
    checkoutSessionQueries.pendingSessions({
      userId: userId!,
      organizationId,
      storeId,
    })
  );

  const handleOnCheckoutClick = async () => {
    // send post
    const bagItems = bag.items.map((item: any) => ({
      productSkuId: item.productSkuId,
      quantity: item.quantity,
      productSku: item.productSku,
      productId: item.productId,
    }));

    setIsProcessingCheckoutRequest(true);

    const res = await obtainCheckoutSession({
      bagItems,
      bagId: bag._id,
      bagSubtotal: bagSubtotal * 100,
    });

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
    <FadeIn className="container mx-auto max-w-[1024px] space-y-24 py-16">
      <div className="space-y-2">
        <h1 className="text-2xl font-light">Bag</h1>
        {data && data.length > 0 && <PendingItem session={data[0]} />}
      </div>

      {isBagEmpty && (
        <EmptyState message="You don't have any items in your bag." />
      )}

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
                            <motion.p
                              // variants={cellVariants}
                              className="text-xs text-destructive"
                            >
                              {unavailableSku.available === 0
                                ? "Currently unavailable"
                                : `Only ${unavailableSku.available} left`}
                            </motion.p>
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
            <div className="space-y-16 rounded-lg sticky top-8">
              <div className="space-y-4 text-sm">
                <div className="flex justify-between mb-2">
                  <span>Subtotal</span>
                  <span>{formatter.format(bagSubtotal)}</span>
                </div>
                <div className="flex justify-between mb-2">
                  <span>Shipping</span>
                  <span>Calculated at checkout</span>
                </div>
              </div>
              <div className="flex justify-between font-medium">
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
              <div className="flex justify-between text-lg font-medium mb-4">
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
    </FadeIn>
  );
}
