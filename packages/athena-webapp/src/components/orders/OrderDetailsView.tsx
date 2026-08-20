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
      className="flex items-center gap-layout-xs border-success/20 bg-success/10 text-success"
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
      header={<p className="text-sm font-medium text-foreground">Payment</p>}
    >
      <div className="pt-layout-md">
        <div className="space-y-layout-md">
          {/* Payment Method Display */}
          <div className="flex items-start justify-between gap-layout-md">
            <div className="flex min-w-0 items-start gap-layout-sm">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
                {isPODOrder ? (
                  podMethod === "mobile_money" ? (
                    <Smartphone className="h-4 w-4" />
                  ) : (
                    <Banknote className="h-4 w-4" />
                  )
                ) : (
                  <Smartphone className="h-4 w-4" />
                )}
              </div>

              <div className="min-w-0 space-y-layout-2xs">
                <p className="text-sm font-medium leading-5 text-foreground">
                  {isPODOrder
                    ? podMethod === "mobile_money"
                      ? "Mobile Money on Delivery"
                      : "Cash on Delivery"
                    : `${paymentMethod?.bank} ${paymentChannel}`}
                </p>
                {!isPODOrder && paymentMethod?.last4 ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    Account ending in {paymentMethod.last4}
                  </p>
                ) : null}
              </div>
            </div>

            {isPODOrder ? (
              order.paymentCollected ? (
                <Badge
                  variant="outline"
                  className="shrink-0 gap-layout-xs border-success/20 bg-success/10 text-success"
                >
                  <CircleCheck className="h-3 w-3" />
                  <span>Collected</span>
                </Badge>
              ) : null
            ) : order.hasVerifiedPayment ? (
              <Badge
                variant="outline"
                className="shrink-0 gap-layout-xs border-success/20 bg-success/10 text-success"
              >
                <BadgeCheckIcon className="h-3 w-3" />
                <span>Verified</span>
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="shrink-0 border-warning/25 bg-warning/10 text-warning-foreground"
              >
                <span>Not verified</span>
              </Badge>
            )}
          </div>

          {isPODOrder && !order.paymentCollected ? (
            <Button
              variant="utility"
              size="sm"
              className="w-full active:scale-[0.98]"
              onClick={handleMarkPaymentCollected}
            >
              Mark payment as collected
            </Button>
          ) : null}

          {!isPODOrder &&
            !order.hasVerifiedPayment &&
            !order.autoVerifiedAt && (
              <div className="flex items-start gap-layout-sm rounded-md border border-warning/20 bg-warning/5 p-layout-sm">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                <div className="space-y-layout-2xs">
                  <p className="text-xs font-medium text-foreground">
                    Verification pending
                  </p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Automatic verification has not run yet.
                  </p>
                </div>
              </div>
            )}

          {order.hasVerifiedPayment && (
            <div className="flex border-t border-border/70 pt-layout-md">
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
            <div className="space-y-layout-sm border-t border-border/70 pt-layout-md">
              <p className="text-xs font-medium text-muted-foreground">
                Payment Instructions
              </p>
              <div className="rounded-md border border-warning/20 bg-warning/5 p-layout-sm">
                <div className="flex items-start gap-layout-sm">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                  <div className="space-y-layout-xs">
                    <p className="text-sm font-medium text-foreground">
                      Payment collection required
                    </p>
                    <p className="text-sm leading-5 text-muted-foreground">
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
