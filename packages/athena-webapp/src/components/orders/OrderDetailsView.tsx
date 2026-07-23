import {
  Check,
  Banknote,
  Smartphone,
  Clock,
  CircleCheck,
  BadgeCheckIcon,
} from "lucide-react";
import View from "../View";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import { currencyFormatter } from "~/src/lib/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { Badge } from "../ui/badge";
import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Button } from "../ui/button";
import { toast } from "sonner";
import { useAuth } from "~/src/hooks/useAuth";
import { getAmountPaidForOrder } from "./utils";
import { toDisplayAmount } from "~/convex/lib/currency";
import { presentCommandToast } from "~/src/lib/errors/presentCommandToast";
import { runCommand } from "~/src/lib/errors/runCommand";

const VerifiedBadge = ({
  status,
  withCheck = true,
}: {
  status: string;
  withCheck?: boolean;
}) => {
  return (
    <Badge
      variant={"outline"}
      className="flex items-center gap-2 border-success/20 bg-success/10 text-success"
    >
      <p className="text-xs">{status}</p>
      {withCheck && <Check className="h-4 w-4" />}
    </Badge>
  );
};

export function OrderDetailsView() {
  const { isSharedDemoSessionOrder, order, updateSessionOrder } =
    useOnlineOrder();
  const { activeStore } = useGetActiveStore();
  const { user } = useAuth();

  const formatter = currencyFormatter(activeStore?.currency || "GHS");

  const updateOrder = useMutation(api.storeFront.onlineOrder.update);

  useQuery(
    api.storeFront.onlineOrder.isDuplicateOrder,
    order?._id ? { id: order._id } : "skip",
  );

  const handleMarkPaymentCollected = async () => {
    if (isSharedDemoSessionOrder) {
      const now = Date.now();
      updateSessionOrder({
        paymentCollected: true,
        paymentCollectedAt: now,
        transitions: [
          ...(order?.transitions ?? []),
          {
            date: now,
            signedInAthenaUser: user
              ? {
                  email: user.email,
                  id: user._id,
                }
              : undefined,
            status: "payment_collected",
          },
        ],
      });
      toast.success("Payment marked as collected");
      return;
    }

    const result = await runCommand(() =>
      updateOrder({
        orderId: order?._id,
        update: {
          paymentCollected: true,
          paymentCollectedAt: Date.now(),
        },
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

    toast.success("Payment marked as collected");
  };

  if (!order || !activeStore) return null;

  const { paymentMethod } = order;
  const isPODOrder =
    order.isPODOrder || paymentMethod?.type === "payment_on_delivery";
  const podMethod =
    order.podPaymentMethod || paymentMethod?.podPaymentMethod || "cash";

  const paymentChannel =
    paymentMethod?.channel == "mobile_money" ? "Mobile Money" : "Card";

  const amountPaid = getAmountPaidForOrder(order);

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      fullHeight={false}
      lockDocumentScroll={false}
      className="w-full"
      header={
        <div className="flex items-center gap-2">
          <p className="text-sm text-sm text-muted-foreground">Payment</p>{" "}
          {order.hasVerifiedPayment && (
            <div className="flex gap-1 items-center">
              <BadgeCheckIcon className="h-3 w-3 text-success" />
              <p className="text-xs font-medium text-success">Verified</p>
            </div>
          )}
        </div>
      }
    >
      <div className="py-4">
        <div className="space-y-4">
          {/* Payment Method Display */}
          <div className="flex items-center gap-1">
            <div className="space-y-2">
              {isPODOrder ? (
                <div className="flex items-center gap-2">
                  {podMethod === "mobile_money" ? (
                    <Smartphone className="w-4 h-4" />
                  ) : (
                    <Banknote className="w-4 h-4" />
                  )}
                  <p className="text-sm">
                    {podMethod === "mobile_money"
                      ? "Mobile Money on Delivery"
                      : "Cash on Delivery"}
                  </p>
                </div>
              ) : (
                <p className="text-sm">{`${paymentMethod?.bank} ${paymentChannel}`}</p>
              )}
            </div>
            {!isPODOrder && paymentMethod?.last4 ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{`ending in ${paymentMethod.last4}`}</p>
              </div>
            ) : null}

            {/* Payment Status Badges */}
            {isPODOrder ? (
              // POD Payment Status
              <div className="flex items-center gap-4">
                {order.paymentCollected ? (
                  <Badge
                    variant="outline"
                    className="flex items-center gap-2 border-success/20 bg-success/10 text-success"
                  >
                    <CircleCheck className="w-3 h-3" />
                    <p className="text-xs">Payment Collected</p>
                  </Badge>
                ) : (
                  <Button variant="link" onClick={handleMarkPaymentCollected}>
                    Mark as collected
                  </Button>
                )}
              </div>
            ) : (
              // Regular Payment Status
              !order.hasVerifiedPayment && (
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="text-yellow-600 bg-yellow-50"
                  >
                    <p className="text-xs">Not verified</p>
                  </Badge>
                  {!order.autoVerifiedAt && (
                    <p className="text-xs text-muted-foreground italic">
                      Auto-verification hasn't been attempted yet
                    </p>
                  )}
                </div>
              )
            )}
          </div>

          {order.hasVerifiedPayment && (
            <div className="flex">
              <VerifiedBadge
                status={`Paid ${formatter.format(toDisplayAmount(amountPaid))}`}
                withCheck={false}
              />
            </div>
          )}

          {/* Payment Details */}
          {/* {!isPODOrder && (
            <div className="space-y-4">
              <p className="text-sm">{`Account ending in ${paymentMethod?.last4}`}</p>
            </div>
          )} */}

          {/* Reference Information */}
          {/* <div className="flex items-center gap-8">
            {!isPODOrder ? (
              <p className="text-sm">
                External payment reference <b>{order?.externalReference}</b>
              </p>
            ) : (
              <p className="text-sm">
                Order reference <b>{order?.orderNumber}</b>
              </p>
            )}

            {isDuplicateQuery && (
              <Badge variant={"outline"} className="bg-gray-50 text-gray-600">
                <TriangleAlert className="h-4 w-4 mr-2" />
                <p className="text-xs">Duplicate order</p>
              </Badge>
            )}
          </div> */}

          {/* POD Payment Instructions */}
          {isPODOrder && !order.paymentCollected && (
            <div className="space-y-4 pt-8">
              <p className="text-sm text-muted-foreground">
                Payment Instructions
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Clock className="w-4 h-4 text-amber-600 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-amber-800">
                      Payment collection required
                    </p>
                    <p className="text-sm text-amber-700">
                      Collect payment via{" "}
                      {podMethod === "mobile_money" ? "mobile money" : "cash"}{" "}
                      when the order is{" "}
                      {order.deliveryMethod === "pickup"
                        ? "picked up"
                        : "delivered"}
                      .
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </View>
  );
}
