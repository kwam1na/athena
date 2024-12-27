import { Link } from "@tanstack/react-router";
import View from "../View";
import { CustomerDetailsView } from "./CustomerDetailsView";
import { OrderDetailsView } from "./OrderDetailsView";
import { OrderItemsView } from "./OrderItemsView";
import { PickupDetailsView } from "./PickupDetailsView";
import { Button } from "../ui/button";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircledIcon,
} from "@radix-ui/react-icons";
import { Badge } from "../ui/badge";
import { AlertCircleIcon, Ban, RotateCcw, Store, Truck } from "lucide-react";
import {
  OnlineOrderProvider,
  useOnlineOrder,
} from "~/src/contexts/OnlineOrderContext";
import { LoadingButton } from "../ui/loading-button";
import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { currencyFormatter, getRelativeTime } from "~/src/lib/utils";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { AlertModal } from "../ui/modals/alert-modal";
import { set } from "zod";

export function RefundOptions() {
  const { order } = useOnlineOrder();
  const { activeStore } = useGetActiveStore();
  const [refundOptions, setRefundOptions] = useState<{
    type: "items" | "order" | "partial" | null;
    showModal: boolean;
    amount?: number;
  }>({ showModal: false, type: null });

  const [isRefundingOrder, setIsRefundingOrder] = useState(false);

  const refundOrder = useAction(api.storeFront.payment.refundPayment);

  if (!order || !activeStore) return null;

  const handleRefundOrder = async ({
    returnToStock,
  }: {
    returnToStock: boolean;
  }) => {
    try {
      setIsRefundingOrder(true);
      await refundOrder({
        externalTransactionId: order?.externalTransactionId,
        amount: refundOptions.amount,
        returnItemsToStock: returnToStock,
      });

      toast("Order refunded", {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });
    } catch (error) {
      console.error(error);
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (error as Error).message,
      });
    } finally {
      setIsRefundingOrder(false);
      setRefundOptions({ showModal: false, type: null });
    }
  };

  const formatter = currencyFormatter(activeStore.currency);

  const itemsTotal =
    order?.items?.reduce(
      (acc, item: any) => acc + item.price * item.quantity,
      0
    ) || 0;

  const alertTitle =
    refundOptions.type == "items"
      ? "Refund items in order"
      : refundOptions.type == "order"
        ? "Refund entire order"
        : "Refund";

  return (
    <>
      <AlertModal
        title={alertTitle}
        description="Do you want to return the items to stock?"
        isOpen={refundOptions.showModal}
        loading={isRefundingOrder}
        onClose={() => {
          setRefundOptions({ showModal: false, type: null });
        }}
        onConfirm={() => handleRefundOrder({ returnToStock: true })}
        onSecondaryConfirm={() => handleRefundOrder({ returnToStock: false })}
        ctaText="Yes"
        secondaryCtaText="No"
        showCancel={false}
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">
            <RotateCcw className="h-4 w-4 mr-2" />
            <p className="text-sm">Refund</p>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[240px]">
          <div className="flex flex-col gap-4 text-sm">
            {/* {order.deliveryFee && (
            <Button variant={"ghost"}>
              <p className="text-sm text-left w-full text-muted-foreground">
                {`Delivery fee - ${formatter.format(order.deliveryFee)}`}
              </p>
            </Button>
          )} */}

            <Button
              variant={"ghost"}
              onClick={() =>
                setRefundOptions({
                  showModal: true,
                  amount: itemsTotal * 100,
                  type: "items",
                })
              }
            >
              <p className="text-sm text-left w-full text-muted-foreground">
                {`Items - ${formatter.format(itemsTotal)}`}
              </p>
            </Button>

            <Button
              variant={"ghost"}
              onClick={() =>
                setRefundOptions({
                  showModal: true,
                  type: "order",
                })
              }
            >
              <p className="text-sm text-left w-full text-muted-foreground">
                {`Entire order - ${formatter.format(order.amount / 100)}`}
              </p>
            </Button>

            <Button variant={"ghost"}>
              <p className="text-sm text-left w-full text-muted-foreground">
                Partial
              </p>
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

const Header = () => {
  const { order } = useOnlineOrder();

  const updateOrder = useMutation(api.storeFront.onlineOrder.update);

  const [isUpdatingOrder, setIsUpdatingOrder] = useState(false);

  const isDelivery = order?.deliveryMethod === "delivery";
  const isPickup = order?.deliveryMethod === "pickup";

  const handleUpdateOrder = async () => {
    try {
      setIsUpdatingOrder(true);
      await updateOrder({
        orderId: order?._id,
        update: { status: "ready" },
      });
      toast("Order marked as ready", {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });
    } catch (error) {
      console.error(error);
    } finally {
      setIsUpdatingOrder(false);
    }
  };

  if (!order) return null;

  const hasIssuedRefund = order.status === "refunded";

  const isRefundPending = ["refund-pending", "refund-processing"].includes(
    order.status
  );

  const refundText = isRefundPending ? "Refund pending" : "Refunded";

  const isInRefundState = isRefundPending || hasIssuedRefund;

  const canRefund = !hasIssuedRefund && !isRefundPending;

  const isReady = order?.items?.every((item) => item.isReady);

  const isOrderOpen = order?.status === "open";

  const orderStatus = isDelivery ? "Ready for delivery" : "Ready for pickup";

  return (
    <div className="container mx-auto flex gap-2 h-[40px] items-center justify-between">
      <div className="flex gap-4 items-center">
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/orders"
          params={(prev) => ({
            ...prev,
            storeUrlSlug: prev.storeUrlSlug!,
            orgUrlSlug: prev.orgUrlSlug!,
          })}
          className="flex items-center gap-2"
        >
          <Button variant="ghost" className="h-8 px-2 lg:px-3 ">
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
        </Link>

        <p className="text-sm">{`Order #${order?.orderNumber}`}</p>

        <Badge className="rounded-lg text-muted-foreground" variant={"outline"}>
          {isOrderOpen && <p>OPEN</p>}
          {order.status == "ready" && <p>{orderStatus.toUpperCase()}</p>}
          {isInRefundState && <p>{refundText.toUpperCase()}</p>}
        </Badge>

        <p className="text-xs text-muted-foreground">
          {`placed ${getRelativeTime(order._creationTime)}`}
        </p>
      </div>

      <div className="flex gap-4">
        {canRefund && <RefundOptions />}

        {isDelivery && isOrderOpen && (
          <LoadingButton
            isLoading={isUpdatingOrder}
            disabled={!isReady}
            onClick={handleUpdateOrder}
            className="px-2 lg:px-3"
          >
            <Truck className="h-4 w-4 mr-2" />
            <p className="text-sm">Ready for delivery</p>
          </LoadingButton>
        )}

        {isPickup && isOrderOpen && (
          <LoadingButton
            isLoading={isUpdatingOrder}
            disabled={!isReady}
            onClick={handleUpdateOrder}
            className="px-2 lg:px-3"
          >
            <Store className="h-4 w-4 mr-2" />
            <p className="text-sm">Ready for pickup</p>
          </LoadingButton>
        )}
      </div>
    </div>
  );
};

const VerifyPaymentAlert = () => {
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);
  const { order } = useOnlineOrder();

  const verifyPayment = useAction(api.storeFront.payment.verifyPayment);

  if (!order) return null;

  if (order.hasVerifiedPayment) return null;

  const handleVerifyPayment = async () => {
    try {
      setIsVerifyingPayment(true);
      const res = await verifyPayment({
        customerId: order.customerId,
        externalReference: order.externalReference,
      });

      if (!res.verified) {
        toast("Unable to verify payment", {
          icon: <Ban className="w-4 h-4" />,
          description: res.message,
        });
      } else {
        toast("Payment verified", {
          icon: <CheckCircledIcon className="w-4 h-4" />,
        });
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsVerifyingPayment(false);
    }
  };

  return (
    <div className="flex gap-2 items-center p-4 rounded-lg bg-yellow-50">
      <AlertCircleIcon className="h-4 w-4 text-yellow-800" />
      <div className="flex items-center">
        <p className="text-sm text-yellow-800">
          Payment for this order has not been verified.
        </p>
        <LoadingButton
          isLoading={isVerifyingPayment}
          onClick={handleVerifyPayment}
          variant={"link"}
          className="text-yellow-800"
        >
          <p className="text-sm underline">Verify payment</p>
        </LoadingButton>
      </div>
    </div>
  );
};

const Alerts = () => {
  return (
    <>
      <VerifyPaymentAlert />
    </>
  );
};

export const OrderView = () => {
  return (
    <OnlineOrderProvider>
      <View hideBorder hideHeaderBottomBorder header={<Header />}>
        <div className="container mx-auto h-full w-full p-8 space-y-8">
          <Alerts />
          <OrderDetailsView />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-8">
              <CustomerDetailsView />
              <PickupDetailsView />
            </div>

            <OrderItemsView />
          </div>
        </div>
      </View>
    </OnlineOrderProvider>
  );
};