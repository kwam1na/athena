import View from "../View";
import { CustomerDetailsView } from "./CustomerDetailsView";
import { OrderDetailsView } from "./OrderDetailsView";
import { OrderItemsView } from "./OrderItemsView";
import { PickupDetailsView } from "./PickupDetailsView";
import { Button } from "../ui/button";
import { CheckCircledIcon } from "@radix-ui/react-icons";
import {
  AlertCircleIcon,
  RotateCcw,
  Store,
  Truck,
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
import { ActionModal } from "../ui/modals/action-modal";
import { Switch } from "../ui/switch";
import { Label } from "../ui/label";
import { RefundsView } from "./RefundsView";
import { ActivityView } from "./ActivityView";
import { getOrderState, getPickupActionState } from "./utils";
import { OrderStatus } from "./OrderStatus";
import { EmailStatusView } from "./EmailStatusView";
import { ComposedPageHeader } from "../common/PageHeader";
import { useAuth } from "~/src/hooks/useAuth";
import { useSharedDemoContext } from "~/src/hooks/useSharedDemoContext";
import { ReturnExchangeView } from "./ReturnExchangeView";
import { presentCommandToast } from "~/src/lib/errors/presentCommandToast";
import { runCommand } from "~/src/lib/errors/runCommand";

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
    const externalTransactionId = order.externalTransactionId;
    if (!externalTransactionId) {
      toast.error("This order does not have a refundable payment reference.");
      return;
    }
    try {
      setIsRefundingOrder(true);
      const result = await runCommand(() =>
        refundOrder({
          externalTransactionId,
          amount: refundOptions.amount,
          returnItemsToStock: returnToStock,
        }),
      );

      if (result.kind !== "ok") {
        presentCommandToast(result);
        return;
      }

      toast("Order refunded", {
        icon: <CheckCircledIcon className="w-4 h-4" />,
        description: result.data.message,
      });
    } finally {
      setIsRefundingOrder(false);
      setRefundOptions({ showModal: false, type: null });
    }
  };

  const formatter = currencyFormatter(activeStore.currency);

  const itemsTotal =
    order.items?.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0,
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
  const sharedDemo = useSharedDemoContext();

  const { user } = useAuth();

  const updateOrder = useMutation(api.storeFront.onlineOrder.update);

  const [isUpdatingOrder, setIsUpdatingOrder] = useState(false);
  const [cancelOrderState, setCancelOrderState] = useState<{
    showModal: boolean;
    returnToStock: boolean;
  }>({
    showModal: false,
    returnToStock: true,
  });

  const isDelivery = order?.deliveryMethod === "delivery";
  const isPickup = order?.deliveryMethod === "pickup";

  const handleUpdateOrder = async (
    update: Record<string, unknown>,
    options?: {
      errorMessage?: string;
      successMessage?: string;
    },
  ) => {
    try {
      setIsUpdatingOrder(true);
      const effectiveUpdate =
        sharedDemo &&
        update.status === "picked-up" &&
        update.paymentCollected === true
          ? { status: "picked-up" }
          : update;
      const result = await runCommand(() =>
        updateOrder({
          orderId: order?._id,
          update: effectiveUpdate,
          signedInAthenaUser: user
            ? {
                id: user._id,
                email: user.email,
              }
            : undefined,
        }),
      );

      if (result.kind !== "ok") {
        presentCommandToast(result);
        return;
      }

      toast(
        options?.successMessage ??
          (typeof effectiveUpdate.status === "string"
            ? `Order marked as ${slugToWords(effectiveUpdate.status)}`
            : "Order updated"),
        {
          icon: <CheckCircledIcon className="w-4 h-4" />,
        },
      );
    } finally {
      setIsUpdatingOrder(false);
    }
  };

  const handleCancelOrder = async () => {
    try {
      setIsUpdatingOrder(true);
      const result = await runCommand(() =>
        updateOrder({
          orderId: order?._id,
          update: { status: "cancelled" },
          returnItemsToStock: cancelOrderState.returnToStock,
          signedInAthenaUser: user
            ? {
                id: user._id,
                email: user.email,
              }
            : undefined,
        }),
      );

      if (result.kind !== "ok") {
        presentCommandToast(result);
        return;
      }

      toast("Order cancelled", {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });
    } finally {
      setIsUpdatingOrder(false);
      setCancelOrderState({
        showModal: false,
        returnToStock: false,
      });
    }
  };

  if (!order) return null;

  const hasIssuedRefund = order.status.includes("refund");

  const isReady = order.items
    ?.filter((i) => !i.isRefunded)
    .every((item) => item.isReady);

  const { isOrderOpen, isOrderReady, isOrderOutForDelivery } =
    getOrderState(order);
  const {
    canMarkPickupException,
    canResolvePickupException,
    needsPickupPaymentCollection,
  } = getPickupActionState(order);
  const isPODPickupOrder =
    isPickup &&
    (order.isPODOrder || order.paymentMethod?.type === "payment_on_delivery");

  const canPerformInitialTransition =
    (order.items?.some((item) => !item.isRefunded) &&
      hasIssuedRefund) ||
    isOrderOpen;

  const orderDate = new Date(order._creationTime);

  return (
    <>
      <ActionModal
        isOpen={cancelOrderState.showModal}
        loading={isUpdatingOrder}
        title="Cancel Order"
        description="Are you sure you want to cancel this order?"
        confirmText="Cancel Order"
        declineText="Keep Order"
        ctaButtonVariant="destructive"
        onClose={() =>
          setCancelOrderState({
            showModal: false,
            returnToStock: false,
          })
        }
        onConfirm={handleCancelOrder}
      >
        <div className="flex">
          <div className="ml-auto flex items-center gap-4">
            <Switch
              id="inventory"
              checked={cancelOrderState.returnToStock}
              onCheckedChange={(checked) => {
                setCancelOrderState((prev) => ({
                  ...prev,
                  returnToStock: checked,
                }));
              }}
            />
            <Label className="text-muted-foreground" htmlFor="inventory">
              Return items to inventory
            </Label>
          </div>
        </div>
      </ActionModal>

      <ComposedPageHeader
        leadingContent={
          <>
            <p className="text-sm">{`Order #${order?.orderNumber}`}</p>

            <div className="text-xs">
              <OrderStatus order={order} />
            </div>

            <p className="text-xs text-muted-foreground">
              {`created ${orderDate.toDateString()}, ${orderDate.toLocaleTimeString()} (${getRelativeTime(order._creationTime)})`}
            </p>
          </>
        }
        trailingContent={
          <div className="flex gap-4">
            {/* Cancel button - only show for open orders */}
            {isOrderOpen && (
              <Button
                variant="outline"
                onClick={() =>
                  setCancelOrderState({
                    showModal: true,
                    returnToStock: true,
                  })
                }
                className="text-red-700 hover:text-red-500 hover:bg-red-100 bg-red-50"
              >
                <XCircle className="h-4 w-4 mr-1" />
                <p className="text-sm">Cancel Order</p>
              </Button>
            )}

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
                onClick={() =>
                  handleUpdateOrder({ status: "out-for-delivery" })
                }
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
                onClick={() =>
                  handleUpdateOrder({ status: "ready-for-pickup" })
                }
                variant={"outline"}
              >
                <Store className="h-4 w-4 mr-1" />
                <p className="text-sm">&rarr; Ready for pickup</p>
              </LoadingButton>
            )}

            {canMarkPickupException && (
              <LoadingButton
                isLoading={isUpdatingOrder}
                disabled={!isReady}
                onClick={() =>
                  handleUpdateOrder(
                    { status: "pickup-exception" },
                    {
                      errorMessage: "Failed to record pickup exception",
                      successMessage: "Pickup exception recorded",
                    },
                  )
                }
                variant={"outline"}
                className="text-amber-700 hover:text-amber-700 hover:bg-amber-50"
              >
                <AlertCircleIcon className="h-4 w-4 mr-1" />
                <p className="text-sm">&rarr; Pickup exception</p>
              </LoadingButton>
            )}

            {isPickup && canResolvePickupException && (
              <LoadingButton
                isLoading={isUpdatingOrder}
                disabled={!isReady}
                onClick={() =>
                  handleUpdateOrder(
                    { status: "ready-for-pickup" },
                    {
                      errorMessage:
                        "Failed to return order to ready for pickup",
                      successMessage: "Order returned to ready for pickup",
                    },
                  )
                }
                variant={"outline"}
              >
                <Store className="h-4 w-4 mr-1" />
                <p className="text-sm">&rarr; Back to ready</p>
              </LoadingButton>
            )}

            {canMarkPickupException && (
              <LoadingButton
                isLoading={isUpdatingOrder}
                disabled={!isReady}
                onClick={() =>
                  handleUpdateOrder(
                    needsPickupPaymentCollection
                      ? {
                          paymentCollected: true,
                          paymentCollectedAt: Date.now(),
                          status: "picked-up",
                        }
                      : { status: "picked-up" },
                    {
                      errorMessage: needsPickupPaymentCollection
                        ? "Failed to collect payment and complete pickup"
                        : "Failed to mark order as picked up",
                      successMessage: needsPickupPaymentCollection
                        ? sharedDemo
                          ? "Order marked as picked up. No payment was collected."
                          : "Payment collected and order marked as picked up"
                        : "Order marked as picked up",
                    },
                  )
                }
                variant={"outline"}
              >
                <Store className="h-4 w-4 mr-1" />
                <p className="text-sm">
                  {needsPickupPaymentCollection && isPODPickupOrder
                    ? sharedDemo
                      ? "\u2192 Mark picked up (payment simulated)"
                      : "\u2192 Collect payment & mark picked up"
                    : "\u2192 Picked up"}
                </p>
              </LoadingButton>
            )}
          </div>
        }
      />
    </>
  );
};

export const OrderView = () => {
  return (
    <OnlineOrderProvider>
      <View header={<Header />}>
        <div className="container mx-auto w-full p-8 space-y-12 pb-24">
          {/* <Alerts /> */}
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

            <div className="space-y-8">
              <ReturnExchangeView />
              <RefundsView />
            </div>
          </div>

          <ActivityView />
        </div>
      </View>
    </OnlineOrderProvider>
  );
};
