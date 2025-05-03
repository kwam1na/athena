import { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertCircleIcon,
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
import { ArrowRightIcon } from "@radix-ui/react-icons";
import ImageWithFallback from "../ui/image-with-fallback";
import { useNavigationBarContext } from "@/contexts/NavigationBarProvider";
import { useCheckoutSessionQueries } from "@/lib/queries/checkout";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";
import { postAnalytics } from "@/api/analytics";

const PendingItem = ({ session, count }: { session: any; count: number }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0, transition: { ease: easeInOut } }}
      className="flex items-center"
    >
      <motion.div
        animate={{
          scale: [1, 1.2, 1],
        }}
        transition={{
          duration: 1.6,
          ease: "easeInOut",
          repeat: Infinity,
        }}
      >
        <InfoIcon className="w-4 h-4" />
      </motion.div>
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
  const { formatter, userId, isNavbarShowing } = useStoreContext();

  const { setNavBarLayout, setAppLocation } = useNavigationBarContext();

  useEffect(() => {
    setNavBarLayout("fixed");
    setAppLocation("shop");
  }, []);

  const {
    bag,
    bagSubtotal,
    deleteItemFromBag,
    updateBag,
    isUpdatingBag,
    operationSuccessful,
    moveItemFromBagToSaved,
    obtainCheckoutSession,
    unavailableProducts,
  } = useShoppingBag();

  const [isProcessingCheckoutRequest, setIsProcessingCheckoutRequest] =
    useState(false);

  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();

  const queryClient = useQueryClient();

  const checkoutSessionQueries = useCheckoutSessionQueries();

  const promoCodeQueries = usePromoCodesQueries();

  const { data: promoCodeItems } = useQuery(promoCodeQueries.getAllItems());

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

  const { data: pendingSessions } = useQuery(
    checkoutSessionQueries.pendingSessions()
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
      const [res] = await Promise.all([
        obtainCheckoutSession({
          bagItems,
          bagId: bag?._id as string,
          bagSubtotal: bagSubtotal * 100,
        }),
        postAnalytics({
          action: "initiated_checkout",
          data: {},
        }).catch((error) => console.error("Failed to post analytics:", error)),
      ]);

      if (res.session) {
        queryClient.setQueryData(["active-checkout-session", userId], {
          session: res.session,
        });
        navigate({
          to: "/shop/checkout",
        });
      } else {
        setError(res.message);
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

  const hasPendingOrders = Boolean(
    pendingSessions && pendingSessions.length > 0
  );

  return (
    <FadeIn className="container mx-auto max-w-[1024px] px-6 xl:px-0 space-y-8 lg:space-y-24 py-8">
      {!isBagEmpty && (
        <div className="space-y-4">
          {hasPendingOrders && (
            <PendingItem
              session={pendingSessions?.[0]}
              count={pendingSessions?.length || 0}
            />
          )}
          <h1 className="text-lg font-light">Bag</h1>

          {operationSuccessful == false && (
            <div className="flex items-center font-medium">
              <AlertCircleIcon className="w-4 h-4 mr-2" />
              <p className="text-xs">Something went wrong. Try again.</p>
            </div>
          )}

          {error && (
            <div className="flex items-center font-medium">
              <AlertCircleIcon className="w-4 h-4 mr-2" />
              <p className="text-xs">{error}</p>
            </div>
          )}
        </div>
      )}

      {isBagEmpty && (
        <div className="space-y-8">
          {hasPendingOrders && (
            <PendingItem
              session={pendingSessions?.[0]}
              count={pendingSessions?.length || 0}
            />
          )}
          <EmptyState
            message="Your bag is empty. Let's fix that!"
            cta={"Shop Now"}
          />
        </div>
      )}

      {!isBagEmpty && total !== 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-56">
          <div className="md:col-span-2 space-y-24">
            <AnimatePresence initial={false} custom={bagAction}>
              {bag?.items.map((item: BagItem, index: number) => {
                const unavailableSku = isSkuUnavailable(item.productSkuId);

                const isDiscounted = promoCodeItems?.some(
                  (promoCodeItem) =>
                    promoCodeItem?.productSku?._id === item.productSkuId
                );

                let priceLabel = "Product unavailable";

                if (item.price) {
                  priceLabel = formatter.format(item.price * item.quantity);
                } else if (isDiscounted && item.price == 0) {
                  priceLabel = "Free";
                }

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
                            {priceLabel}
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
                            onClick={async () => {
                              setBagAction("moving-to-saved-bag");
                              await Promise.all([
                                moveItemFromBagToSaved(item),
                                postAnalytics({
                                  action: "added_product_to_saved",
                                  origin: "shopping_bag",
                                  data: {
                                    product: item.productId,
                                    productSku: item.productSku,
                                    productImageUrl: item.productImage,
                                  },
                                }),
                              ]);
                            }}
                          >
                            <Heart className="h-4 w-4" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="icon"
                            className={`${isUpdatingBag ? "pointer-events-none" : ""}`}
                            onClick={async () => {
                              setBagAction("deleting-from-bag");
                              await Promise.all([
                                deleteItemFromBag(item._id),
                                postAnalytics({
                                  action: "removed_product_from_bag",
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
                      className={`group w-[240px] text-accent2 ${isUpdatingBag ? "pointer-events-none" : ""}`}
                      variant={"clear"}
                      disabled={hasPendingOrders}
                    >
                      Checkout
                      <ArrowRight className="w-4 h-4 ml-2 -me-1 ms-2 transition-transform group-hover:translate-x-0.5" />
                    </LoadingButton>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </div>
      )}
    </FadeIn>
  );
}
