import { useNavigate, useSearch } from "@tanstack/react-router";
import View from "../View";
import { CustomerDetailsView } from "./CustomerDetailsView";
import { OrderDetailsView } from "./OrderDetailsView";
import { OrderItemsView } from "./OrderItemsView";
import { PickupDetailsView } from "./PickupDetailsView";
import { Button } from "../ui/button";
import { ArrowLeftIcon, CheckCircledIcon } from "@radix-ui/react-icons";
import { Badge } from "../ui/badge";
import {
  AlertCircleIcon,
  Ban,
  RotateCcw,
  Store,
  Truck,
  X,
  XCircle,
} from "lucide-react";
import {
  OnlineOrderProvider,
  useOnlineOrder,
} from "~/src/contexts/OnlineOrderContext";
import { LoadingButton } from "../ui/loading-button";
import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import {
  currencyFormatter,
  getRelativeTime,
  slugToWords,
} from "~/src/lib/utils";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { AlertModal } from "../ui/modals/alert-modal";
import { RefundsView } from "./RefundsView";
import { ActivityView } from "./ActivityView";
import { getOrderState } from "./utils";
import { OrderStatus } from "./OrderStatus";
import { EmailStatusView } from "./EmailStatusView";
import { ComposedPageHeader } from "../common/PageHeader";
import { useAuth } from "~/src/hooks/useAuth";

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
        externalTransactionId: order?.externalTransactionId!,
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

  const { user } = useAuth();

  const updateOrder = useMutation(api.storeFront.onlineOrder.update);

  const [isUpdatingOrder, setIsUpdatingOrder] = useState(false);

  const isDelivery = order?.deliveryMethod === "delivery";
  const isPickup = order?.deliveryMethod === "pickup";

  const handleUpdateOrder = async (update: Record<string, any>) => {
    try {
      setIsUpdatingOrder(true);
      await updateOrder({
        orderId: order?._id,
        update,
        signedInAthenaUser: user
          ? {
              id: user._id,
              email: user.email,
            }
          : undefined,
      });
      toast(`Order marked as ${slugToWords(update.status)}`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });
    } catch (error) {
      console.error(error);
    } finally {
      setIsUpdatingOrder(false);
    }
  };

  if (!order) return null;

  const hasIssuedRefund = order.status.includes("refund");

  const isReady = order?.items
    ?.filter((i) => !Boolean(i.isRefunded))
    .every((item) => item.isReady);

  const { isOrderOpen, isOrderReady, isOrderOutForDelivery } =
    getOrderState(order);

  const canPerformInitialTransition =
    (order.items?.some((item) => !Boolean(item.isRefunded)) &&
      hasIssuedRefund) ||
    isOrderOpen;

  return (
    <ComposedPageHeader
      leadingContent={
        <>
          <p className="text-sm">{`Order #${order?.orderNumber}`}</p>

          <div className="text-xs">
            <OrderStatus order={order} />
          </div>

          <p className="text-xs text-muted-foreground">
            {`placed ${getRelativeTime(order._creationTime)}`}
          </p>
        </>
      }
      trailingContent={
        <div className="flex gap-4">
          {isDelivery && canPerformInitialTransition && (
            <LoadingButton
              isLoading={isUpdatingOrder}
              disabled={!isReady}
              onClick={() =>
                handleUpdateOrder({ status: "ready-for-delivery" })
              }
              variant={"outline"}
            >
              <Truck className="h-4 w-4 mr-1" />
              <p className="text-sm">&rarr; Ready for delivery</p>
            </LoadingButton>
          )}

          {isDelivery && isOrderReady && (
            <LoadingButton
              isLoading={isUpdatingOrder}
              disabled={!isReady}
              onClick={() => handleUpdateOrder({ status: "out-for-delivery" })}
              variant={"outline"}
            >
              <Truck className="h-4 w-4 mr-1" />
              <p className="text-sm">&rarr; Out for delivery</p>
            </LoadingButton>
          )}

          {isOrderOutForDelivery && (
            <LoadingButton
              isLoading={isUpdatingOrder}
              disabled={!isReady}
              onClick={() => handleUpdateOrder({ status: "delivered" })}
              variant={"outline"}
            >
              <Truck className="h-4 w-4 mr-1" />
              <p className="text-sm">&rarr; Delivered</p>
            </LoadingButton>
          )}

          {isPickup && canPerformInitialTransition && (
            <LoadingButton
              isLoading={isUpdatingOrder}
              disabled={!isReady}
              onClick={() => handleUpdateOrder({ status: "ready-for-pickup" })}
              variant={"outline"}
            >
              <Store className="h-4 w-4 mr-1" />
              <p className="text-sm">&rarr; Ready for pickup</p>
            </LoadingButton>
          )}

          {isPickup && isOrderReady && (
            <LoadingButton
              isLoading={isUpdatingOrder}
              disabled={!isReady}
              onClick={() => handleUpdateOrder({ status: "picked-up" })}
              variant={"outline"}
            >
              <Store className="h-4 w-4 mr-1" />
              <p className="text-sm">&rarr; Picked up</p>
            </LoadingButton>
          )}
        </div>
      }
    />
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
        storeFrontUserId: order.storeFrontUserId,
        externalReference: order.externalReference!,
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
    <div className="flex gap-2 items-center px-4 rounded-lg text-yellow-700 bg-yellow-50">
      <AlertCircleIcon className="h-4 w-4" />
      <div className="flex items-center">
        <p className="text-sm">Payment for this order has not been verified.</p>
        <LoadingButton
          isLoading={isVerifyingPayment}
          onClick={handleVerifyPayment}
          variant={"link"}
        >
          <p className="text-sm text-yellow-700 underline">Verify payment</p>
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
      <View header={<Header />}>
        <div className="container mx-auto h-full w-full p-8 space-y-12">
          <Alerts />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-8">
              <div className="grid grid-cols-1 gap-8">
                <OrderDetailsView />
                <EmailStatusView />
              </div>
            </div>

            <OrderItemsView />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-8">
              <div className="grid grid-cols-1 gap-8">
                <PickupDetailsView />
                <CustomerDetailsView />
              </div>
            </div>

            <RefundsView />
          </div>

          <ActivityView />
        </div>
      </View>
    </OnlineOrderProvider>
  );
};
