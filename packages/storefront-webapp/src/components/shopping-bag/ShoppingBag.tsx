import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Heart,
  Info,
  InfoIcon,
  OctagonAlert,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { Link, useNavigate } from "@tanstack/react-router";
import placeholder from "@/assets/placeholder.png";
import { ShoppingBagAction, useShoppingBag } from "@/hooks/useShoppingBag";
import { BagItem, ProductSku } from "@athena/webapp";
import { getProductName } from "@/lib/utils";
import { motion, AnimatePresence, easeInOut } from "framer-motion";
import { HeartIconFilled } from "@/assets/icons/HeartIconFilled";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoadingButton } from "../ui/loading-button";
import { EmptyState } from "../states/empty/empty-state";
import { FadeIn } from "../common/FadeIn";
import { checkoutSessionQueries } from "@/queries";
import { ArrowRightIcon } from "@radix-ui/react-icons";
import ImageWithFallback from "../ui/image-with-fallback";

const PendingItem = ({ session, count }: { session: any; count: number }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0, transition: { ease: easeInOut } }}
      className="flex items-center"
    >
      <InfoIcon className="w-4 h-4" />
      <Link
        to={
          count == 1
            ? "/shop/checkout/$sessionIdSlug"
            : "/shop/checkout/pending"
        }
        params={{ sessionIdSlug: session._id }}
        className="flex items-center"
      >
        <Button variant={"link"}>
          <p className="text-xs underline">
            {count > 1
              ? `You have ${count} pending orders`
              : "You have a pending order"}
          </p>
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

  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();

  const queryClient = useQueryClient();

  const total = bagSubtotal;

  const isBagEmpty = bag?.items?.length === 0;

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
    const bagItems =
      bag?.items.map((item: any) => ({
        productSkuId: item.productSkuId,
        quantity: item.quantity,
        productSku: item.productSku,
        productId: item.productId,
        price: item.price,
      })) || [];

    setIsProcessingCheckoutRequest(true);
    setError(null);

    try {
      const res = await obtainCheckoutSession({
        bagItems,
        bagId: bag?._id as string,
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
    } catch (e) {
      setError((e as Error).message);
      setIsProcessingCheckoutRequest(false);
    }
  };

  const isSkuUnavailable = (skuId: string) => {
    return unavailableProducts.find((p) => p.productSkuId == skuId);
  };

  return (
    <FadeIn className="container mx-auto max-w-[1024px] px-6 xl:px-0 space-y-8 lg:space-y-24 py-8">
      {!isBagEmpty && (
        <div className="space-y-4">
          {Boolean(data && data.length > 0) && (
            <PendingItem session={data?.[0]} count={data?.length || 0} />
          )}
          <h1 className="text-lg font-light">Bag</h1>

          {areProductsUnavailable && (
            <div className="flex items-center">
              <AlertCircle className="w-4 h-4 mr-2" />
              <p className="text-xs">
                Some items in your bag are no longer available
              </p>
            </div>
          )}
        </div>
      )}

      {isBagEmpty && (
        <div className="space-y-8">
          {Boolean(data && data.length > 0) && (
            <PendingItem session={data?.[0]} count={data?.length || 0} />
          )}
          <EmptyState message="Your bag is empty." />
        </div>
      )}

      {!isBagEmpty && total !== 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-56">
          <div className="md:col-span-2 space-y-24">
            <AnimatePresence initial={false} custom={bagAction}>
              {bag?.items.map((item: BagItem, index: number) => {
                const unavailableSku = isSkuUnavailable(item.productSkuId);

                return (
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
                      {bagAction == "deleting-from-bag" ? (
                        <Trash2 className="text-gray-300 w-16 h-16" />
                      ) : (
                        <HeartIconFilled width={56} height={56} />
                      )}
                    </motion.div>

                    <motion.div
                      exit="exit"
                      variants={cellVariants}
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
                        <div className="flex flex-col gap-2 lg:gap-4">
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
                              updateBag({
                                quantity: parseInt(e.target.value),
                                itemId: item._id,
                              })
                            }
                            disabled={!item.price}
                            className={`w-12 py-2 bg-background text-xs ${isUpdatingBag ? "pointer-events-none" : ""}`}
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
                            className={`${isUpdatingBag ? "pointer-events-none" : ""}`}
                            disabled={!item.price}
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
                            className={`${isUpdatingBag ? "pointer-events-none" : ""}`}
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

          {isNavbarShowing && (
            <div className="fixed bottom-0 left-0 w-full z-50">
              <motion.div
                initial={{ opacity: 0, y: 32 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { ease: "easeOut", duration: 0.3, delay: 0.5 },
                }}
                className="space-y-8 flex p-4 bg-accent5 border border-accent5"
              >
                <div className="ml-auto flex gap-12">
                  <div className="space-y-2">
                    <div className="flex gap-8 text-sm text-accent2">
                      <strong>TOTAL</strong>
                      <strong>{formatter.format(total)}</strong>
                    </div>

                    <p className="text-xs">* excluding taxes and shipping</p>
                  </div>

                  <div className="space-y-4">
                    <LoadingButton
                      isLoading={isProcessingCheckoutRequest}
                      onClick={handleOnCheckoutClick}
                      className="group w-[240px] text-accent2"
                      variant={"clear"}
                    >
                      Checkout
                      <ArrowRight className="w-4 h-4 ml-2 -me-1 ms-2 transition-transform group-hover:translate-x-0.5" />
                    </LoadingButton>

                    {error && (
                      <div className="flex text-xs items-center">
                        <OctagonAlert className="w-4 h-4 mr-2" />
                        <p>{error}</p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </div>
          )}

          {/* Mobile Cart Summary */}
          {/* {isNavbarShowing && (
            <div className="flex flex-col md:hidden fixed bottom-0 left-0 w-full bg-background p-8 shadow-md z-50 min-h-auto">
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

                {error && (
                  <div className="flex text-destructive">
                    <InfoIcon className="w-4 h-4 mr-2" />
                    <p className="text-xs">{error}</p>
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
          )} */}
        </div>
      )}
    </FadeIn>
  );
}
