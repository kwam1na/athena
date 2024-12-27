import {
  AlertTriangleIcon,
  AtSign,
  Ban,
  Circle,
  InfoIcon,
  Package2,
  Phone,
  RotateCcw,
  Send,
  UserRound,
} from "lucide-react";
import View from "../View";
import { Button } from "../ui/button";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import { Checkbox } from "../ui/checkbox";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { currencyFormatter, getRelativeTime } from "~/src/lib/utils";
import { useState } from "react";
import { getProductName } from "~/src/lib/productUtils";
import { AnyRouter } from "@tanstack/react-router";
import { useAction } from "convex/react";
import { api } from "~/convex/_generated/api";
import { toast } from "sonner";
import { CheckCircledIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { AlertModal } from "../ui/modals/alert-modal";
import { ActionModal } from "../ui/modals/action-modal";
import { Switch } from "../ui/switch";
import { Label } from "../ui/label";
import { Separator } from "../ui/separator";

export function RefundsView() {
  const { order } = useOnlineOrder();
  const { activeStore } = useGetActiveStore();
  const [state, setState] = useState<{
    entireOrder: boolean;
    deliveryFees: boolean;
    subtotal: boolean;
    partial: boolean;
    amountToRefund: number;
    returnToStock: boolean;
    showModal: boolean;
    onlineOrderItemIds: string[];
  }>({
    entireOrder: false,
    deliveryFees: false,
    subtotal: false,
    partial: false,
    amountToRefund: 0,
    returnToStock: false,
    showModal: false,
    onlineOrderItemIds: [],
  });

  const [isRefundingOrder, setIsRefundingOrder] = useState(false);

  const refundOrder = useAction(api.storeFront.payment.refundPayment);

  if (!order || !activeStore) return null;

  const formatter = currencyFormatter(activeStore.currency);

  const refundText =
    state.amountToRefund > 0
      ? `Refund ${formatter.format(state.amountToRefund / 100)}`
      : "Refund";

  const handleRefundOrder = async () => {
    console.table(state);

    try {
      setIsRefundingOrder(true);
      const res = await refundOrder({
        externalTransactionId: order?.externalTransactionId,
        amount: state.amountToRefund,
        returnItemsToStock: state.returnToStock,
        onlineOrderItemIds: state.onlineOrderItemIds,
      });

      if (res.success) {
        toast("Operation succeeded", {
          icon: <CheckCircledIcon className="w-4 h-4" />,
          description: res.message,
        });
      } else {
        toast("Operation failed", {
          icon: <Ban className="w-4 h-4" />,
          description: res.message,
        });
      }
    } catch (error) {
      console.error(error);
      toast("Operation failed", {
        icon: <Ban className="w-4 h-4" />,
        description: (error as Error).message,
      });
    } finally {
      setIsRefundingOrder(false);
      setState((prev) => ({
        ...prev,
        showModal: false,
        returnToStock: false,
      }));
    }
  };

  const amountRefunded =
    order?.refunds?.reduce((acc, refund) => acc + refund.amount, 0) || 0;

  const isPartiallyRefunded =
    amountRefunded > 0 && amountRefunded < order.amount;

  const canRefund = amountRefunded < order.amount || isPartiallyRefunded;

  if (!canRefund) return null;

  return (
    <View
      className="h-auto w-full"
      header={<p className="text-sm text-sm text-muted-foreground">Refund</p>}
    >
      <ActionModal
        isOpen={state.showModal}
        loading={isRefundingOrder}
        title={`Refunding ${formatter.format(state.amountToRefund! / 100)}`}
        description=""
        declineText="Cancel"
        confirmText="Proceed"
        onClose={() =>
          setState((prev) => ({
            ...prev,
            showModal: false,
            returnToStock: false,
          }))
        }
        onConfirm={() => handleRefundOrder()}
      >
        <div className="flex">
          <div className="ml-auto flex items-center gap-4">
            <Switch
              id="inventory"
              checked={state.returnToStock}
              disabled={!state.entireOrder && !state.subtotal && !state.partial}
              onCheckedChange={(checked) => {
                setState((prev) => ({
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
      <div className="p-8 space-y-12">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={state.entireOrder}
              disabled={!canRefund}
              onCheckedChange={() => {
                setState((prev) => ({
                  ...prev,
                  entireOrder: !prev.entireOrder,
                  deliveryFees: false,
                  subtotal: false,
                  partial: false,
                  amountToRefund: !prev.entireOrder ? order.amount : 0,
                }));
              }}
            />
            <p className="text-sm">Entire order</p>
          </div>

          {order.deliveryFee && (
            <div className="flex items-center gap-2">
              <Checkbox
                disabled={state.entireOrder || state.partial || !canRefund}
                checked={state.deliveryFees}
                onCheckedChange={() => {
                  setState((prev) => ({
                    ...prev,
                    deliveryFees: !prev.deliveryFees,
                    amountToRefund: !prev.deliveryFees
                      ? prev.amountToRefund + order.deliveryFee! * 100
                      : prev.amountToRefund - order.deliveryFee! * 100,
                  }));
                }}
              />
              <p className="text-sm">Delivery fees</p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              disabled={state.entireOrder || state.partial || !canRefund}
              checked={state.subtotal}
              onCheckedChange={() => {
                setState((prev) => ({
                  ...prev,
                  subtotal: !prev.subtotal,
                  amountToRefund: !prev.subtotal
                    ? prev.amountToRefund +
                      (order.amount -
                        (order.deliveryFee ? order.deliveryFee * 100 : 0))
                    : prev.amountToRefund -
                      (order.amount -
                        (order.deliveryFee ? order.deliveryFee * 100 : 0)),
                }));
              }}
            />
            <p className="text-sm">Subtotal</p>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              disabled={
                state.entireOrder ||
                state.deliveryFees ||
                state.subtotal ||
                !canRefund
              }
              checked={state.partial}
              onCheckedChange={() => {
                setState((prev) => ({
                  ...prev,
                  partial: !prev.partial,
                  amountToRefund: 0,
                }));
              }}
            />
            <p className="text-sm">Partial</p>
          </div>

          {state.partial && (
            <div className="ml-4 space-y-4">
              {order.items?.map((item: any) => {
                return (
                  <div key={item.productId} className="flex items-center gap-4">
                    <Checkbox
                      disabled={
                        state.entireOrder ||
                        state.deliveryFees ||
                        state.subtotal ||
                        item.isRefunded
                      }
                      onCheckedChange={(checked) => {
                        setState((prev) => ({
                          ...prev,
                          amountToRefund: checked
                            ? prev.amountToRefund +
                              item.quantity * item.price * 100
                            : prev.amountToRefund -
                              item.quantity * item.price * 100,
                          onlineOrderItemIds: checked
                            ? [...prev.onlineOrderItemIds, item._id]
                            : prev.onlineOrderItemIds.filter(
                                (id) => id !== item._id
                              ),
                        }));
                      }}
                    />

                    <img
                      src={item.productImage}
                      alt={item.productName || "product image"}
                      className="w-8 h-8 aspect-square object-cover rounded-lg"
                    />

                    <div className="space-y-2 text-xs">
                      <p>{getProductName(item)}</p>
                      <p className="text-muted-foreground">{`x${item.quantity}`}</p>
                    </div>

                    {item.isRefunded && (
                      <div className="flex ml-auto items-center gap-2 text-muted-foreground">
                        <RotateCcw className="h-3 w-3" />
                        <p className="text-xs">Refunded</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex">
          <Button
            variant="outline"
            disabled={state.amountToRefund <= 0 || isRefundingOrder}
            onClick={() =>
              setState((prev) => ({
                ...prev,
                showModal: true,
              }))
            }
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            {refundText}
          </Button>
        </div>
      </div>
    </View>
  );
}
