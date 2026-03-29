import { Ban, InfoIcon, RotateCcw } from "lucide-react";
import View from "../View";
import { Button } from "../ui/button";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { currencyFormatter } from "~/src/lib/utils";
import { useReducer, Reducer } from "react";
import { getProductName } from "~/src/lib/productUtils";
import { useAction } from "convex/react";
import { api } from "~/convex/_generated/api";
import { toast } from "sonner";
import { CheckCircledIcon } from "@radix-ui/react-icons";
import { ActionModal } from "../ui/modals/action-modal";
import { Switch } from "../ui/switch";
import { Label } from "../ui/label";
import { useAuth } from "~/src/hooks/useAuth";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import {
  refundReducer,
  calculateRefundAmount,
  validateRefund,
  getAmountRefunded,
  getNetAmount,
  getAvailableItems,
  getItemsToRefund,
  shouldShowReturnToStock,
  type RefundMode,
  type RefundState,
  type RefundAction,
} from "./refundUtils";

export function RefundsView() {
  const { order } = useOnlineOrder();
  const { activeStore } = useGetActiveStore();
  const [state, dispatch] = useReducer<Reducer<RefundState, RefundAction>>(
    refundReducer,
    {
      mode: null,
      selectedItemIds: new Set<string>(),
      includeDeliveryFee: false,
      returnToStock: false,
      showModal: false,
    }
  );

  const [isRefundingOrder, toggleIsRefundingOrder] = useReducer(
    (state: boolean) => !state,
    false
  );

  const { user } = useAuth();
  const refundOrder = useAction(api.storeFront.payment.refundPayment);

  if (!order || !activeStore) return null;

  const isPODOrder =
    order.isPODOrder || order.paymentMethod?.type === "payment_on_delivery";

  const formatter = currencyFormatter(activeStore.currency);

  // Calculate amounts
  const amountRefunded = getAmountRefunded(order);
  const netAmount = getNetAmount(order);
  const refundAmount = calculateRefundAmount(
    order,
    state.mode,
    state.selectedItemIds,
    state.includeDeliveryFee
  );
  const availableItems = getAvailableItems(order);

  const canRefund = netAmount > 0;

  const refundText =
    refundAmount > 0
      ? `Refund ${formatter.format(refundAmount / 100)}`
      : "Refund";

  const handleRefundOrder = async () => {
    // Validate before submitting
    const validation = validateRefund(
      order,
      state.mode,
      state.selectedItemIds,
      state.includeDeliveryFee
    );
    if (!validation.isValid) {
      toast("Invalid refund", {
        icon: <Ban className="w-4 h-4" />,
        description: validation.error,
      });
      return;
    }

    try {
      toggleIsRefundingOrder();

      const itemIds = getItemsToRefund(
        order,
        state.mode,
        state.selectedItemIds
      );

      // Include delivery fee in refund items if selected
      const refundItems =
        state.includeDeliveryFee && !order.didRefundDeliveryFee
          ? ["delivery-fee"]
          : [];

      const res = await refundOrder({
        externalTransactionId: order.externalTransactionId!,
        amount: refundAmount,
        returnItemsToStock: state.returnToStock,
        onlineOrderItemIds: itemIds as any,
        refundItems,
        signedInAthenaUser: user
          ? {
              id: user._id,
              email: user.email,
            }
          : undefined,
      });

      if (res.success) {
        toast("Refund successful", {
          icon: <CheckCircledIcon className="w-4 h-4" />,
          description: res.message,
        });
        dispatch({ type: "RESET" });
      } else {
        toast("Refund failed", {
          icon: <Ban className="w-4 h-4" />,
          description: res.message,
        });
      }
    } catch (error) {
      console.error(error);
      toast("Refund failed", {
        icon: <Ban className="w-4 h-4" />,
        description: (error as Error).message,
      });
    } finally {
      toggleIsRefundingOrder();
      dispatch({ type: "HIDE_MODAL" });
    }
  };

  if (!canRefund) return null;

  // POD orders cannot be refunded through Paystack - show different UI
  if (isPODOrder) {
    return (
      <View
        hideBorder
        hideHeaderBottomBorder
        className="h-auto w-full"
        header={<p className="text-sm text-sm text-muted-foreground">Refund</p>}
      >
        <div className="py-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <InfoIcon className="w-4 h-4 text-blue-600 mt-0.5" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-blue-800">
                  Payment on Delivery Order
                </p>
                <p className="text-sm text-blue-700">
                  This order uses payment on delivery. Refunds must be processed
                  manually since no online payment was made.
                  {!order.paymentCollected &&
                    " No payment has been collected yet."}
                </p>
                {order.paymentCollected && (
                  <p className="text-sm text-blue-700">
                    Payment was collected on{" "}
                    {order.paymentCollectedAt
                      ? new Date(order.paymentCollectedAt).toLocaleDateString()
                      : "unknown date"}
                    . Process refund manually and update order status as needed.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </View>
    );
  }

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={<p className="text-sm text-muted-foreground">Refund</p>}
    >
      <ActionModal
        isOpen={state.showModal}
        loading={isRefundingOrder}
        title={`Refund ${formatter.format(refundAmount / 100)}`}
        description="This action cannot be undone. The refund will be processed immediately."
        declineText="Cancel"
        confirmText="Proceed with Refund"
        onClose={() => dispatch({ type: "HIDE_MODAL" })}
        onConfirm={handleRefundOrder}
      >
        <div className="space-y-4 py-4">
          {/* Refund breakdown */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Items to refund:</span>
              <span className="font-medium">
                {state.mode === "entire-order" || state.mode === "remaining"
                  ? availableItems.length
                  : state.selectedItemIds.size}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Refund amount:</span>
              <span className="font-medium">
                {formatter.format(refundAmount / 100)}
              </span>
            </div>
          </div>

          {/* Return to stock option */}
          {shouldShowReturnToStock(state.mode, order) && (
            <div className="flex items-center gap-3 pt-4 border-t">
              <Switch
                id="inventory"
                checked={state.returnToStock}
                onCheckedChange={() =>
                  dispatch({ type: "TOGGLE_RETURN_TO_STOCK" })
                }
              />
              <Label htmlFor="inventory" className="cursor-pointer">
                Return items to inventory
              </Label>
            </div>
          )}
        </div>
      </ActionModal>

      <div className="py-4 space-y-6">
        {/* Amount summary */}
        <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Original amount:</span>
            <span>{formatter.format(order.amount / 100)}</span>
          </div>
          {amountRefunded > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Already refunded:</span>
              <span className="text-destructive">
                -{formatter.format(amountRefunded / 100)}
              </span>
            </div>
          )}
          <div className="flex justify-between font-medium pt-2 border-t">
            <span>Available to refund:</span>
            <span>{formatter.format(netAmount / 100)}</span>
          </div>
        </div>

        {/* Refund options */}
        <div className="space-y-4">
          <p className="text-sm font-medium">Select refund option:</p>

          <RadioGroup
            value={state.mode || ""}
            onValueChange={(value: string) =>
              dispatch({ type: "SET_MODE", mode: value as RefundMode })
            }
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="entire-order" id="entire-order" />
              <Label htmlFor="entire-order" className="cursor-pointer">
                Entire order
                <span className="ml-2 text-xs text-muted-foreground">
                  (Refund all {availableItems.length} items -{" "}
                  {formatter.format(netAmount / 100)})
                </span>
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <RadioGroupItem value="partial" id="partial" />
              <Label htmlFor="partial" className="cursor-pointer">
                Partial refund
                <span className="ml-2 text-xs text-muted-foreground">
                  (Select specific items)
                </span>
              </Label>
            </div>

            {amountRefunded > 0 && (
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="remaining" id="remaining" />
                <Label htmlFor="remaining" className="cursor-pointer">
                  Remaining balance
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({formatter.format(netAmount / 100)})
                  </span>
                </Label>
              </div>
            )}
          </RadioGroup>

          {/* Partial items selection */}
          {state.mode === "partial" && (
            <div className="ml-6 space-y-3 pt-2">
              {availableItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  All items have been refunded
                </p>
              ) : (
                availableItems.map((item) => (
                  <div
                    key={item._id}
                    className="flex items-center gap-4 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
                    onClick={() =>
                      dispatch({ type: "TOGGLE_ITEM", itemId: item._id })
                    }
                  >
                    <input
                      type="checkbox"
                      checked={state.selectedItemIds.has(item._id)}
                      onChange={() =>
                        dispatch({ type: "TOGGLE_ITEM", itemId: item._id })
                      }
                      className="cursor-pointer"
                    />

                    <img
                      src={item.productImage}
                      alt={item.productName || "product image"}
                      className="w-10 h-10 aspect-square object-cover rounded-lg"
                    />

                    <div className="flex-1 space-y-1 text-sm">
                      <p className="font-medium">{getProductName(item)}</p>
                      <p className="text-xs text-muted-foreground">
                        Qty: {item.quantity} × {formatter.format(item.price)}
                      </p>
                    </div>

                    <div className="text-sm font-medium">
                      {formatter.format(item.price * item.quantity)}
                    </div>
                  </div>
                ))
              )}

              {/* Delivery fee option */}
              {order.deliveryFee && !order.didRefundDeliveryFee && (
                <div
                  className="flex items-center gap-4 p-2 rounded-lg hover:bg-muted/50 cursor-pointer border-t pt-3"
                  onClick={() => dispatch({ type: "TOGGLE_DELIVERY_FEE" })}
                >
                  <input
                    type="checkbox"
                    checked={state.includeDeliveryFee}
                    onChange={() => dispatch({ type: "TOGGLE_DELIVERY_FEE" })}
                    className="cursor-pointer"
                  />

                  <div className="flex-1 text-sm">
                    <p className="font-medium">Delivery fee</p>
                    <p className="text-xs text-muted-foreground">
                      Include delivery charge in refund
                    </p>
                  </div>

                  <div className="text-sm font-medium">
                    {formatter.format(order.deliveryFee)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Refund preview and action */}
        {state.mode && (
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Refund amount</p>
              <p className="text-2xl font-semibold">
                {formatter.format(refundAmount / 100)}
              </p>
            </div>

            <Button
              variant="outline"
              disabled={refundAmount <= 0 || isRefundingOrder}
              onClick={() => dispatch({ type: "SHOW_MODAL" })}
              className="min-w-[140px]"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {refundText}
            </Button>
          </div>
        )}
      </div>
    </View>
  );
}
