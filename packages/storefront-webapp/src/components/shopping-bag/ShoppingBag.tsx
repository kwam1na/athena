import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  AlertCircleIcon,
  ArrowRight,
  Award,
  Gift,
  Heart,
  HeartIcon,
  Info,
  InfoIcon,
  OctagonAlert,
  Timer,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import placeholder from "@/assets/placeholder.png";
import { ShoppingBagAction, useShoppingBag } from "@/hooks/useShoppingBag";
import { BagItem, ProductSku } from "@athena/webapp";
import { capitalizeWords, getProductName } from "@/lib/utils";
import { motion, AnimatePresence, easeInOut } from "framer-motion";
import { HeartIconFilled } from "@/assets/icons/HeartIconFilled";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoadingButton } from "../ui/loading-button";
import { EmptyState } from "../states/empty/empty-state";
import { FadeIn } from "../common/FadeIn";
import { ArrowRightIcon } from "@radix-ui/react-icons";
import ImageWithFallback from "../ui/image-with-fallback";
import { useCheckoutSessionQueries } from "@/lib/queries/checkout";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";
import {
  createBagMoveToSavedEvent,
  createDiscountCodeTriggerEvent,
} from "@/lib/storefrontJourneyEvents";
import { useDiscountCodeAlert } from "@/hooks/useDiscountCodeAlert";
import { WelcomeBackModal } from "./promotion/WelcomeBackModal";
import { useProductDiscount } from "@/hooks/useProductDiscount";
import { DiscountBadge } from "../product-page/DiscountBadge";
import { useInventoryStatus } from "@/hooks/useInventoryStatus";
import { getStoreConfigV2 } from "@/lib/storeConfig";
import { formatStoredAmount } from "@/lib/currency";
import { useStorefrontObservability } from "@/hooks/useStorefrontObservability";
import {
  createBagRemoveSucceededEvent,
  createBagViewedEvent,
  createCheckoutStartEvent,
} from "@/lib/storefrontJourneyEvents";

const PendingItem = ({ session, count }: { session: any; count: number }) => {
  return (
    <div className="flex items-center rounded-md border border-info/30 bg-info/10 px-layout-sm py-layout-xs text-info-foreground">
      <InfoIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <Link
        to={
          count == 1
            ? "/shop/checkout/$sessionIdSlug"
            : "/shop/checkout/pending"
        }
        params={{ sessionIdSlug: session._id }}
        className="flex min-h-control-compact items-center"
      >
        <Button variant="link" className="text-info-foreground">
          <span className="text-xs underline">
            {count > 1
              ? `You have ${count} pending orders`
              : "You have a pending order"}
          </span>
        </Button>
        <ArrowRightIcon className="w-4 h-4" />
      </Link>
    </div>
  );
};

type ShoppingBagCheckoutButtonProps = {
  hasPendingOrders: boolean;
  isProcessingCheckoutRequest: boolean;
  isUpdatingBag: boolean;
  onCheckoutClick: () => void | Promise<void>;
};

export function ShoppingBagCheckoutButton({
  hasPendingOrders,
  isProcessingCheckoutRequest,
  isUpdatingBag,
  onCheckoutClick,
}: ShoppingBagCheckoutButtonProps) {
  return (
    <LoadingButton
      isLoading={isProcessingCheckoutRequest}
      onClick={onCheckoutClick}
      data-testid="storefront-bag-start-checkout"
      className={`group min-h-control-standard w-full min-w-48 sm:w-auto ${isUpdatingBag ? "pointer-events-none" : ""}`}
      disabled={hasPendingOrders}
    >
      <span className="font-medium">Checkout</span>
      <ArrowRight className="w-4 h-4 ml-2 -me-1 ms-2 transition-transform group-hover:translate-x-0.5" />
    </LoadingButton>
  );
}

type BagItemWithDiscountProps = {
  item: BagItem;
  index: number;
  bagAction: ShoppingBagAction;
  isNavbarShowing: boolean;
  isUpdatingBag: boolean;
  formatter: Intl.NumberFormat;
  unavailableProducts: any[];
  inventoryStatus?: { inventoryCount: number; quantityAvailable: number };
  onUpdateBag: (params: { quantity: number; itemId: string }) => void;
  onMoveToSaved: (item: BagItem) => Promise<void>;
  onDelete: (itemId: string) => Promise<void>;
  onUpdateItemTotal: (itemId: string, total: number) => void;
};

const BagItemWithDiscount = ({
  item,
  index,
  bagAction,
  isNavbarShowing,
  isUpdatingBag,
  formatter,
  unavailableProducts,
  inventoryStatus,
  onUpdateBag,
  onMoveToSaved,
  onDelete,
  onUpdateItemTotal,
}: BagItemWithDiscountProps) => {
  const discountInfo = useProductDiscount(item.productSkuId, item.price);

  const { store } = useStoreContext();
  const storeConfig = getStoreConfigV2(store);

  // Calculate item total with discount
  const itemPrice = discountInfo.hasDiscount
    ? discountInfo.discountedPrice
    : item.price || 0;
  const itemTotal = itemPrice * item.quantity;

  // Report discounted total to parent
  useEffect(() => {
    onUpdateItemTotal(item._id, itemTotal);
  }, [item._id, itemTotal, onUpdateItemTotal]);

  const unavailableSku = unavailableProducts.find(
    (p) => p.productSkuId == item.productSkuId,
  );

  let priceLabel = "Product unavailable";
  let showDiscount = discountInfo.hasDiscount && item.price && item.price > 0;

  if (item.price && item.price > 0) {
    if (showDiscount) {
      priceLabel = formatStoredAmount(
        formatter,
        discountInfo.discountedPrice * item.quantity,
      );
    } else {
      priceLabel = formatStoredAmount(formatter, item.price * item.quantity);
    }
  } else if (discountInfo.hasDiscount && discountInfo.discountedPrice === 0) {
    priceLabel = "Free";
    showDiscount = true;
  }

  const showHurryMessage =
    inventoryStatus &&
    inventoryStatus.quantityAvailable > 0 &&
    inventoryStatus.quantityAvailable <= 3;

  const showHighDemandMessage = Boolean(
    item.otherBagsWithSku && item.otherBagsWithSku >= 3,
  );

  return (
    <motion.article
      key={item._id}
      layout={isNavbarShowing}
      className="space-y-layout-sm rounded-lg border border-border bg-surface p-layout-sm shadow-surface"
    >
      <div className="relative flex">
        <motion.div
          className="absolute inset-0 flex px-16 items-center pointer-events-none"
          variants={{
            exit: (bagAction: ShoppingBagAction) => ({
              opacity: 0,
              x: bagAction == "deleting-from-bag" ? 0 : -24,
            }),
          }}
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
          variants={{
            exit: (bagAction: ShoppingBagAction) => ({
              opacity: 0,
              x: bagAction == "deleting-from-bag" ? 0 : -24,
            }),
          }}
          className="relative z-10 flex w-full items-start gap-layout-sm sm:gap-layout-lg"
        >
          <Link
            key={index}
            to={"/shop/product/$productSlug"}
            params={() => ({ productSlug: item.productId })}
            search={{
              variant: item.productSku,
              origin: "shopping_bag",
            }}
            className="shrink-0"
          >
            <div className="relative h-28 w-24 overflow-hidden rounded-md sm:h-36 sm:w-32">
              <ImageWithFallback
                src={
                  (item as any)?.productImage ||
                  storeConfig.media.images.fallbackImageUrl
                }
                alt={(item as any).productName || "product image"}
                className="h-full w-full object-cover"
              />

              <DiscountBadge
                size="xs"
                productSkuId={item.productSkuId}
                productPrice={item.price}
              />
            </div>
          </Link>

          <div className="min-w-0 flex-1 space-y-layout-sm text-sm">
            <div className="flex flex-col gap-layout-xs">
              <h2 className="font-medium">{item && getProductName(item)}</h2>

              {showDiscount && item.price && item.price > 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ease: "easeInOut" }}
                  className="flex items-center gap-2"
                >
                  <p className="text-xs text-muted-foreground line-through">
                    {formatStoredAmount(
                      formatter,
                      item.price * item.quantity,
                    )}
                  </p>
                  <p className="text-xs font-medium text-accent2">
                    {priceLabel}
                  </p>
                </motion.div>
              ) : priceLabel === "Free" ? (
                <div className="flex items-center gap-2 text-xs">
                  <p className="text-muted-foreground line-through">
                    {formatStoredAmount(
                      formatter,
                      (item.price || 0) * item.quantity,
                    )}
                  </p>
                  <p className="text-xs font-medium text-accent2">Free</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {item.productCategory !== "Hair" &&
                    (item.colorName || item.size) && (
                      <div className="flex gap-2">
                        {item.productCategory !== "Hair" && item.colorName && (
                          <p className="text-xs font-medium">
                            {capitalizeWords(item.colorName)}
                          </p>
                        )}

                        {item.productCategory !== "Hair" &&
                          item.colorName &&
                          item.size && (
                            <p className="text-xs text-muted-foreground">|</p>
                          )}

                        {item.productCategory !== "Hair" && item.size && (
                          <p className="text-xs font-medium">
                            {capitalizeWords(item.size)}
                          </p>
                        )}
                      </div>
                    )}
                  <p className="text-xs text-muted-foreground">{priceLabel}</p>
                </div>
              )}

              <label className="flex w-fit items-center gap-layout-xs text-xs text-muted-foreground">
                <span>Quantity</span>
                <select
                value={item.quantity}
                onChange={(e) =>
                  onUpdateBag({
                    quantity: parseInt(e.target.value),
                    itemId: item._id,
                  })
                }
                disabled={!item.price}
                aria-label={`Quantity for ${getProductName(item)}`}
                className={`min-h-control-compact w-16 rounded-md border border-input bg-surface px-2 text-xs text-foreground ${isUpdatingBag ? "pointer-events-none" : ""}`}
              >
                {[...Array(10)].map((_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
                </select>
              </label>

              {unavailableSku && (
                <motion.p className="text-xs font-medium text-accent2">
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
                aria-label={`Save ${getProductName(item)} for later`}
                className={`${isUpdatingBag ? "pointer-events-none" : ""}`}
                disabled={!item.price}
                onClick={async () => {
                  await onMoveToSaved(item);
                }}
              >
                <Heart className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${getProductName(item)} from bag`}
                className={`${isUpdatingBag ? "pointer-events-none" : ""}`}
                onClick={async () => {
                  await onDelete(item._id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </motion.div>
      </div>

      {showHighDemandMessage && !showHurryMessage && (
        <div className="flex items-center gap-1 px-4 text-accent2">
          <motion.div>
            <HeartIconFilled width={12} height={12} />
          </motion.div>
          <p className="text-xs font-medium">
            <b>High demand:</b> {item.otherBagsWithSku} other shoppers have this
            in their bag
          </p>
        </div>
      )}

      {showHurryMessage && (
        <div className="flex items-center gap-1 px-4 text-accent2">
          <motion.div>
            <Timer className="w-3.5 h-3.5" />
          </motion.div>
          <p className="text-xs">
            <b>Hurry! Only {inventoryStatus.quantityAvailable} left</b>
          </p>
        </div>
      )}
    </motion.article>
  );
};

export default function ShoppingBag() {
  const [bagAction, setBagAction] = useState<ShoppingBagAction>("idle");
  const [updateCounter, forceUpdate] = useReducer((x) => x + 1, 0);
  const itemTotalsRef = useRef<Map<string, number>>(new Map());
  const hasTrackedBagView = useRef(false);
  const { formatter, userId, isNavbarShowing, store } = useStoreContext();
  const storeConfig = getStoreConfigV2(store);
  const { track } = useStorefrontObservability();

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

  // Extract all productSkuIds from bag items
  const productSkuIds = useMemo(
    () => bag?.items?.map((item: BagItem) => item.productSkuId) || [],
    [bag?.items],
  );

  // Fetch inventory status for all bag items
  const { inventoryMap } = useInventoryStatus(productSkuIds);

  const [isProcessingCheckoutRequest, setIsProcessingCheckoutRequest] =
    useState(false);

  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();

  const queryClient = useQueryClient();

  const checkoutSessionQueries = useCheckoutSessionQueries();

  const {
    isDiscountModalOpen,
    handleCloseDiscountModal,
    hasDiscountModalBeenShown,
    completeDiscountModalFlow,
    hasCompletedDiscountModalFlow,
    openDiscountModal,
  } = useDiscountCodeAlert();

  const isBagEmpty = bag?.items?.length === 0;

  // Calculate total with discounts from ref
  const total = useMemo(() => {
    if (!bag?.items || bag.items.length === 0) {
      return bagSubtotal;
    }

    // Clean up totals for removed items
    const currentItemIds = new Set(bag.items.map((item) => item._id as string));
    for (const itemId of itemTotalsRef.current.keys()) {
      if (!currentItemIds.has(itemId)) {
        itemTotalsRef.current.delete(itemId);
      }
    }

    // Calculate total from current item totals
    const totalWithDiscounts = Array.from(
      itemTotalsRef.current.values(),
    ).reduce((sum, itemTotal) => sum + itemTotal, 0);

    return totalWithDiscounts > 0 ? totalWithDiscounts : bagSubtotal;
  }, [bag?.items, bagSubtotal, updateCounter]);

  const { data: pendingSessions } = useQuery(
    checkoutSessionQueries.pendingSessions(),
  );

  useEffect(() => {
    if (hasTrackedBagView.current || bag === undefined) return;

    hasTrackedBagView.current = true;

    void track(
      createBagViewedEvent({
        bagId: bag?._id,
        itemCount: bag?.items?.length ?? 0,
      }),
    ).catch((error) => {
      console.error("Failed to track bag view:", error);
    });
  }, [bag, track]);

  const handleOnCheckoutClick = async () => {
    setIsProcessingCheckoutRequest(true);
    setError(null);

    try {
      const res = await obtainCheckoutSession({
        bagId: bag?._id as string,
      });

      if (res.session) {
        const checkoutSessionId =
          typeof res.session === "object" &&
          res.session !== null &&
          "_id" in res.session &&
          typeof res.session._id === "string"
            ? res.session._id
            : undefined;

        queryClient.setQueryData(["active-checkout-session", userId], {
          session: res.session,
        });

        await track(
          createCheckoutStartEvent({
            bagId: bag?._id,
            itemCount: bag?.items?.length ?? 0,
            checkoutSessionId,
          }),
        ).catch((error) => {
          console.error("Failed to track checkout start:", error);
        });

        navigate({
          to: "/shop/checkout",
        });
      } else {
        setError(
          typeof res.message === "string"
            ? res.message
            : "Unable to start checkout right now.",
        );
        setIsProcessingCheckoutRequest(false);
      }
    } catch (e) {
      setError((e as Error).message);
      setIsProcessingCheckoutRequest(false);
    }
  };

  const handleClickOnDiscountCode = async () => {
    openDiscountModal();

    await track(
      createDiscountCodeTriggerEvent({
        promoCodeId:
          storeConfig.promotions.homepageDiscountCodeModalPromoCode
            ?.promoCodeId,
      }),
    );
  };

  const isSkuUnavailable = (skuId: string) => {
    return unavailableProducts.find((p) => p.productSkuId == skuId);
  };

  const hasPendingOrders = Boolean(
    pendingSessions && pendingSessions.length > 0,
  );

  const potentialRewards = Math.floor(total * 10);

  const updateItemTotal = useCallback((itemId: string, total: number) => {
    itemTotalsRef.current.set(itemId, total);
    forceUpdate(); // Trigger re-render to recalculate total
  }, []);

  const handleMoveToSaved = async (item: BagItem) => {
    setBagAction("moving-to-saved-bag");
    await Promise.all([
      moveItemFromBagToSaved(item),
      track(
        createBagMoveToSavedEvent({
          productId: item.productId,
          productSku: item.productSku,
          productImageUrl: item.productImage,
        }),
      ),
    ]);
  };

  const handleDeleteItem = async (itemId: string) => {
    setBagAction("deleting-from-bag");
    const item = bag?.items.find((i: BagItem) => i._id === itemId);
    await Promise.all([
      deleteItemFromBag(itemId),
      track(
        createBagRemoveSucceededEvent({
          productId: item?.productId,
          productSku: item?.productSku,
          quantity: item?.quantity,
        }),
      ),
    ]);
  };

  return (
    <FadeIn className="mx-auto w-full max-w-content space-y-layout-xl px-gutter py-layout-xl">
      {!isBagEmpty && (
        <div className="space-y-4 pb-8">
          {hasPendingOrders && (
            <PendingItem
              session={pendingSessions?.[0]}
              count={pendingSessions?.length || 0}
            />
          )}
          <h1 className="font-display text-3xl font-medium">Your bag</h1>

          {/* {potentialRewards > 0 && hasDiscountModalBeenShown && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: { ease: "easeIn", delay: 0.4 },
              }}
              className="space-y-2 border border-accent5 rounded-md p-4 w-fit bg-accent5/40"
            >
              <p className="text-sm font-medium">
                🎉 You're earning{" "}
                <b className="text-accent2">
                  {potentialRewards.toLocaleString()}
                </b>{" "}
                reward points from this order
              </p>
              <p className="text-xs italic text-gray-500">
                Redeemable for discounts on future purchases
              </p>
            </motion.div>
          )} */}

          {/* {!hasCompletedDiscountModalFlow &&
            store?.config?.homepageDiscountCodeModalPromoCode && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { ease: "easeIn", delay: 0.4 },
                }}
                className="group space-y-2 border border-accent5 rounded-md p-4 w-fit bg-accent5/30 cursor-pointer hover:bg-accent5/50 transition-all duration-200"
                onClick={handleClickOnDiscountCode}
              >
                <div className="flex items-center gap-2 text-accent2">
                  <Gift className="w-4 h-4 group-hover:-rotate-6 transition-transform duration-200" />
                  <p className="text-sm font-medium">
                    Special offer! Get 25% off your order
                  </p>
                </div>
              </motion.div>
            )} */}

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
        <div className="grid grid-cols-1 gap-layout-lg pb-40">
          <div className="space-y-layout-lg">
            <AnimatePresence initial={false} custom={bagAction}>
              {bag?.items.map((item: BagItem, index: number) => (
                <BagItemWithDiscount
                  key={item._id}
                  item={item}
                  index={index}
                  bagAction={bagAction}
                  isNavbarShowing={isNavbarShowing}
                  isUpdatingBag={isUpdatingBag}
                  formatter={formatter}
                  unavailableProducts={unavailableProducts}
                  inventoryStatus={inventoryMap.get(item.productSkuId)}
                  onUpdateBag={updateBag}
                  onMoveToSaved={handleMoveToSaved}
                  onDelete={handleDeleteItem}
                  onUpdateItemTotal={updateItemTotal}
                />
              ))}
            </AnimatePresence>
          </div>

          {error && bag?.items?.length && bag?.items?.length > 3 && (
            <div className="flex items-center font-medium pt-16">
              <AlertCircleIcon className="w-4 h-4 mr-2" />
              <p className="text-xs">{error}</p>
            </div>
          )}

          {isNavbarShowing && (
            <div className="fixed bottom-0 left-0 w-full z-50">
              <motion.div
                initial={{ opacity: 0, y: 32 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { ease: "easeOut", duration: 0.3 },
                }}
                className="border-t border-border bg-surface/95 px-gutter py-layout-sm shadow-overlay backdrop-blur motion-reduce:transform-none"
              >
                <div className="mx-auto flex w-full max-w-content flex-col gap-layout-sm sm:flex-row sm:items-center sm:justify-end sm:gap-layout-xl">
                  <div className="space-y-2">
                    <div className="flex justify-between gap-layout-lg text-sm font-medium text-foreground">
                      <p>Total</p>
                      <p>{formatStoredAmount(formatter, total)}</p>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Delivery calculated at checkout
                    </p>
                  </div>

                  <div className="space-y-4">
                    <ShoppingBagCheckoutButton
                      hasPendingOrders={hasPendingOrders}
                      isProcessingCheckoutRequest={isProcessingCheckoutRequest}
                      isUpdatingBag={isUpdatingBag}
                      onCheckoutClick={handleOnCheckoutClick}
                    />
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </div>
      )}

      <WelcomeBackModal
        isOpen={isDiscountModalOpen}
        onClose={handleCloseDiscountModal}
        onSuccess={completeDiscountModalFlow}
        promoCode={storeConfig.promotions.homepageDiscountCodeModalPromoCode}
      />
    </FadeIn>
  );
}
