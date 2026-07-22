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
  canUsePartialRefund,
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
import { presentCommandToast } from "~/src/lib/errors/presentCommandToast";
import { runCommand } from "~/src/lib/errors/runCommand";
import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";
import type { Id } from "~/convex/_generated/dataModel";

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
    },
  );

  const [isRefundingOrder, toggleIsRefundingOrder] = useReducer(
    (state: boolean) => !state,
    false,
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
    state.includeDeliveryFee,
  );
  const availableItems = getAvailableItems(order);
  const partialRefundAvailable = canUsePartialRefund(availableItems.length);

  const canRefund = netAmount > 0;

  const handleRefundOrder = async () => {
    // Validate before submitting
    const validation = validateRefund(
      order,
      state.mode,
      state.selectedItemIds,
      state.includeDeliveryFee,
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
        state.selectedItemIds,
      );

      // Include delivery fee in refund items if selected
      const refundItems =
        state.includeDeliveryFee && !order.didRefundDeliveryFee
          ? ["delivery-fee"]
          : [];

      const result = await runCommand(() =>
        refundOrder({
          externalTransactionId: order.externalTransactionId!,
          amount: refundAmount,
          returnItemsToStock: state.returnToStock,
          onlineOrderItemIds: itemIds as Array<Id<"onlineOrderItem">>,
          refundItems,
          signedInAthenaUser: user
            ? {
                id: user._id,
                email: user.email,
              }
            : undefined,
        }),
      );

      if (result.kind === "ok") {
        toast("Refund successful", {
          icon: <CheckCircledIcon className="w-4 h-4" />,
          description: result.data.message,
        });
        dispatch({ type: "RESET" });
        return;
      }

      presentCommandToast(result);
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
        fullHeight={false}
        lockDocumentScroll={false}
        className="w-full"
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
                    " No payment has been collected yet"}
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
      fullHeight={false}
      lockDocumentScroll={false}
      className="w-full"
      header={<p className="text-base font-medium text-foreground">Refund</p>}
    >
      <ActionModal
        isOpen={state.showModal}
        loading={isRefundingOrder}
        title={`Refund ${formatStoredAmount(formatter, refundAmount)}`}
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
                {formatStoredAmount(formatter, refundAmount)}
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

      <div className="space-y-layout-xl pt-layout-md">
        {/* Amount summary */}
        <div className="space-y-layout-md rounded-lg bg-muted/50 p-layout-md">
          <div className="flex items-baseline justify-between gap-layout-sm text-sm">
            <span className="text-muted-foreground">Original amount</span>
            <span className="font-medium">
              {formatStoredAmount(formatter, order.amount)}
            </span>
          </div>
          {amountRefunded > 0 && (
            <>
              <div className="flex items-baseline justify-between gap-layout-sm text-sm">
                <span className="text-muted-foreground">Already refunded</span>
                <span className="text-destructive">
                  -{formatStoredAmount(formatter, amountRefunded)}
                </span>
              </div>
            </>
          )}
          <div className="space-y-1 border-t border-border pt-layout-md">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Available to refund
            </p>
            <p className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
              {formatStoredAmount(formatter, netAmount)}
            </p>
          </div>
        </div>

        {/* Refund options */}
        <div className="space-y-layout-md">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Refund option</p>
            <p className="text-xs leading-5 text-muted-foreground">
              Choose what should be returned to the customer.
            </p>
          </div>

          <RadioGroup
            className="space-y-layout-sm"
            value={state.mode || ""}
            onValueChange={(value: string) => {
              if (value === "partial" && !partialRefundAvailable) return;
              dispatch({ type: "SET_MODE", mode: value as RefundMode });
            }}
          >
            <div className="flex items-start gap-layout-sm rounded-lg border border-border p-layout-sm transition-colors hover:bg-muted/50 active:bg-muted">
              <RadioGroupItem
                className="mt-0.5 shrink-0"
                value="entire-order"
                id="entire-order"
              />
              <Label
                htmlFor="entire-order"
                className="min-w-0 flex-1 cursor-pointer space-y-1 leading-none"
              >
                <span className="block text-sm font-medium text-foreground">
                  Entire order
                </span>
                <span className="block text-xs leading-5 text-muted-foreground">
                  Refund all {availableItems.length} items ·{" "}
                  {formatStoredAmount(formatter, netAmount)}
                </span>
              </Label>
            </div>

            <div
              className={`flex items-start gap-layout-sm rounded-lg border border-border p-layout-sm transition-colors ${
                partialRefundAvailable
                  ? "hover:bg-muted/50 active:bg-muted"
                  : "cursor-not-allowed bg-muted/30 opacity-60"
              }`}
            >
              <RadioGroupItem
                className="mt-0.5 shrink-0"
                disabled={!partialRefundAvailable}
                value="partial"
                id="partial"
              />
              <Label
                htmlFor="partial"
                className={`min-w-0 flex-1 space-y-1 leading-none ${
                  partialRefundAvailable
                    ? "cursor-pointer"
                    : "cursor-not-allowed"
                }`}
              >
                <span className="block text-sm font-medium text-foreground">
                  Partial refund
                </span>
                <span className="block text-xs leading-5 text-muted-foreground">
                  Select specific items to refund.
                </span>
              </Label>
            </div>

            {amountRefunded > 0 && (
              <div className="flex items-start gap-layout-sm rounded-lg border border-border p-layout-sm transition-colors hover:bg-muted/50 active:bg-muted">
                <RadioGroupItem
                  className="mt-0.5 shrink-0"
                  value="remaining"
                  id="remaining"
                />
                <Label
                  htmlFor="remaining"
                  className="min-w-0 flex-1 cursor-pointer space-y-1 leading-none"
                >
                  <span className="block text-sm font-medium text-foreground">
                    Remaining balance
                  </span>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    Refund {formatStoredAmount(formatter, netAmount)}.
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
                        Qty: {item.quantity} ×{" "}
                        {formatStoredAmount(formatter, item.price)}
                      </p>
                    </div>

                    <div className="text-sm font-medium">
                      {formatStoredAmount(
                        formatter,
                        item.price * item.quantity,
                      )}
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
                    {formatStoredAmount(formatter, order.deliveryFee)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Refund preview and action */}
        {state.mode && (
          <div className="space-y-layout-md border-t border-border pt-layout-lg">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Refund amount
              </p>
              <p className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
                {formatStoredAmount(formatter, refundAmount)}
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                You’ll confirm this amount before it is processed.
              </p>
            </div>

            <Button
              variant="outline"
              disabled={refundAmount <= 0 || isRefundingOrder}
              onClick={() => dispatch({ type: "SHOW_MODAL" })}
              className="w-full active:scale-[0.98]"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Review refund
            </Button>
          </div>
        )}
      </div>
    </View>
  );
}
