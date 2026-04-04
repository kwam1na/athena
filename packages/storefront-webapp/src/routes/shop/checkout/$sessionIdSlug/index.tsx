import { updateCheckoutSession } from "@/api/checkoutSession";
import {
  BagSummaryItems,
  toBagSummaryItems,
} from "@/components/checkout/BagSummary";
import { Discount } from "@/components/checkout/types";
import { OrderDetails } from "@/components/checkout/OrderDetails";
import { FadeIn } from "@/components/common/FadeIn";
import { CheckoutSessionGeneric } from "@/components/states/checkout-expired/CheckoutExpired";
import { LoadingButton } from "@/components/ui/loading-button";
import { useCheckoutSessionQueries } from "@/lib/queries/checkout";
import { useOnlineOrderQueries } from "@/lib/queries/onlineOrder";
import { capitalizeFirstLetter } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStorefrontObservability } from "@/hooks/useStorefrontObservability";
import { createOrderReviewViewedEvent } from "@/lib/storefrontJourneyEvents";

const getErrorMessage = (value: unknown, fallback: string) =>
  typeof value === "string" && value.length > 0 ? value : fallback;

export const Route = createFileRoute("/shop/checkout/$sessionIdSlug/")({
  component: () => <CheckoutSession />,
});

const CheckoutSession = () => {
  const { sessionIdSlug } = useParams({ strict: false });

  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [isCancelingOrder, setIsCancelingOrder] = useState(false);
  const [error, setError] = useState("");
  const lastTrackedOrderReview = useRef<string | null>(null);

  const checkoutSessionQueries = useCheckoutSessionQueries();

  const onlineOrderQueries = useOnlineOrderQueries();

  const { data: sessionData, isLoading } = useQuery(
    checkoutSessionQueries.session(sessionIdSlug)
  );

  const { data: onlineOrder, isLoading: isLoadingOnlineOrder } = useQuery(
    onlineOrderQueries.detail(sessionIdSlug!)
  );

  const queryClient = useQueryClient();
  const { track } = useStorefrontObservability();

  useEffect(() => {
    if (!sessionData?._id) return;
    if (lastTrackedOrderReview.current === sessionData._id) return;

    lastTrackedOrderReview.current = sessionData._id;

    void track(
      createOrderReviewViewedEvent({
        checkoutSessionId: sessionData._id,
      }),
    ).catch((error) => {
      console.error("Failed to track order review view:", error);
    });
  }, [sessionData?._id, track]);

  const placeOrder = async () => {
    if (!sessionData || !sessionIdSlug) return;

    setError("");

    try {
      setIsPlacingOrder(true);

      let res;

      if (onlineOrder) {
        // the order has already been placed. update the session to reflect this
        res = await updateCheckoutSession({
          action: "update-order",
          sessionId: sessionIdSlug,
          placedOrderId: onlineOrder._id,
          hasCompletedCheckoutSession: true,
        });
      } else {
        res = await updateCheckoutSession({
          action: "place-order",
          sessionId: sessionIdSlug,
          hasCompletedCheckoutSession: true,
        });
      }

      if (res.orderId || res.success) {
        queryClient.invalidateQueries({
          queryKey: [...checkoutSessionQueries.sessionKey(), sessionIdSlug],
        });

        queryClient.invalidateQueries({
          queryKey: [...checkoutSessionQueries.pendingSessionsKey()],
        });

        window.location.href = `/shop/checkout/${sessionIdSlug}/complete`;
      }

      if (!res.success) {
        setError(getErrorMessage(res.message, "Failed to place order"));
      }

      setIsPlacingOrder(false);
    } catch (e) {
      setIsPlacingOrder(false);
    }
  };

  const navigate = useNavigate();

  const cancelOrder = async () => {
    if (!sessionData || !sessionIdSlug) return;

    setError("");

    try {
      setIsCancelingOrder(true);

      const res = await updateCheckoutSession({
        action: "cancel-order",
        sessionId: sessionIdSlug,
        hasCompletedCheckoutSession: true,
      });

      if (res.success) {
        queryClient.invalidateQueries({
          queryKey: [...checkoutSessionQueries.sessionKey(), sessionIdSlug],
        });

        queryClient.invalidateQueries({
          queryKey: [...checkoutSessionQueries.pendingSessionsKey()],
        });

        navigate({
          to: "/shop/checkout/$sessionIdSlug/canceled",
          params: { sessionIdSlug },
        });
      } else {
        setError(getErrorMessage(res.message, "Failed to cancel order"));
      }

      setIsCancelingOrder(false);
    } catch (e) {
      setIsCancelingOrder(false);
    }
  };

  if ((!sessionData && isLoading) || isLoadingOnlineOrder) return null;

  if (!sessionData && !isLoading) {
    return (
      <CheckoutSessionGeneric message="This checkout session does not exist" />
    );
  }

  if (sessionData?.isPaymentRefunded) {
    return <CheckoutSessionGeneric message="This order has been refunded" />;
  }

  return (
    <AnimatePresence>
      <FadeIn className="container mx-auto max-w-[1024px] px-6 xl:px-0 pt-24 pb-40 space-y-24">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut" },
          }}
          className="space-y-12"
        >
          <p className="text-4xl font-light">{`Almost there, ${capitalizeFirstLetter(sessionData?.customerDetails?.firstName || "")}`}</p>

          <p>Confirm everything looks good to proceed with your order</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { ease: "easeOut" },
          }}
          className="space-y-8 w-full md:w-[40%]"
        >
          <p className="text-xs">Your order</p>

          {sessionData?.items && (
            <BagSummaryItems
              items={toBagSummaryItems(sessionData.items)}
              discount={sessionData.discount as Discount | null}
            />
          )}
        </motion.div>

        <OrderDetails session={sessionData} />

        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut" },
          }}
          className="space-y-8 pt-8"
        >
          {error && (
            <div className="flex items-center gap-2 text-red-700 ">
              <AlertCircle className="w-4 h-4" />
              <motion.p
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  transition: { ease: "easeOut" },
                }}
                className="text-sm"
              >
                {error}
              </motion.p>
            </div>
          )}
          <div className="flex gap-2">
            <LoadingButton
              isLoading={isPlacingOrder}
              onClick={placeOrder}
              className="w-[240px]"
            >
              Submit
            </LoadingButton>

            {!sessionData?.isPaymentRefunded && (
              <LoadingButton
                isLoading={isCancelingOrder}
                onClick={cancelOrder}
                variant={"clear"}
                className="w-[240px]"
              >
                Cancel order
              </LoadingButton>
            )}
          </div>
        </motion.div>
      </FadeIn>
    </AnimatePresence>
  );
};
