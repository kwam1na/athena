import {
  Check,
  Circle,
  Tag,
  TriangleAlert,
  Banknote,
  Smartphone,
  Clock,
  CircleCheck,
  CircleFadingPlus,
  Dot,
  X,
} from "lucide-react";
import View from "../View";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import {
  capitalizeFirstLetter,
  currencyFormatter,
  getRelativeTime,
} from "~/src/lib/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { Badge } from "../ui/badge";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { toast } from "sonner";
import { useAuth } from "~/src/hooks/useAuth";
import { getAmountPaidForOrder } from "./utils";

interface ExternalTransaction {
  id: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  reference: string;
  formattedAmount: string;
}

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
      className="bg-green-50 text-green-600 flex items-center gap-2"
    >
      <p className="text-xs">{status}</p>
      {withCheck && <Check className="h-4 w-4" />}
    </Badge>
  );
};

const ExternalTransaction = ({
  transaction,
}: {
  transaction: ExternalTransaction;
}) => {
  const map = {
    success: "Succeeded",
    failed: "Failed",
    pending: "Pending",
    abandoned: "Abandoned",
    cancelled: "Cancelled",
    refunded: "Refunded",
  };

  const statusColor = {
    success: "text-green-700",
    failed: "text-red-700",
    pending: "text-yellow-700",
    abandoned: "text-gray-700",
    cancelled: "text-red-700",
    refunded: "text-red-700",
  };

  return (
    <div className="space-y-2">
      <div className="w-full flex gap-2">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {transaction.status === "success" ? (
              <Check
                className={`w-3 h-3 ${statusColor[transaction.status as keyof typeof statusColor]}`}
              />
            ) : transaction.status === "failed" ? (
              <X
                className={`w-3 h-3 ${statusColor[transaction.status as keyof typeof statusColor]}`}
              />
            ) : (
              <Circle
                className={`w-2.5 h-2.5 ${statusColor[transaction.status as keyof typeof statusColor]}`}
              />
            )}
            <p
              className={`text-sm ${statusColor[transaction.status as keyof typeof statusColor]}`}
            >
              {map[transaction.status as keyof typeof map]}
            </p>
            <span className="text-sm font-medium">{transaction.reference}</span>
            <span className="text-sm">{transaction.formattedAmount}</span>
            {/* <StatusBadge status={transaction.status} /> */}
          </div>
          <p className="text-xs text-muted-foreground">
            {getRelativeTime(new Date(transaction.createdAt).getTime())}
          </p>
        </div>
      </div>
    </div>
  );
};

export function OrderDetailsView() {
  const { order } = useOnlineOrder();
  const { activeStore } = useGetActiveStore();
  const { user } = useAuth();

  const formatter = currencyFormatter(activeStore?.currency || "GHS");

  const listTransactions = useAction(
    api.storeFront.paystackActions.getAllTransactions
  );

  const updateOrder = useMutation(api.storeFront.onlineOrder.update);

  const [externalTransactions, setExternalTransactions] = useState<
    ExternalTransaction[]
  >([]);

  useEffect(() => {
    const fetchTransactions = async () => {
      const transactions = await listTransactions({
        customerEmail: order?.customerDetails.email,
        sameDay: order?._creationTime,
      });

      setExternalTransactions(
        transactions.data
          .filter(
            (transaction: any) =>
              transaction.metadata.checkout_session_id ==
              order?.checkoutSessionId
          )
          .map((transaction: any) => {
            return {
              id: transaction.id,
              amount: transaction.amount,
              currency: transaction.currency,
              status: transaction.status,
              createdAt: transaction.createdAt,
              reference: transaction.reference,
              formattedAmount: formatter.format(transaction.amount / 100),
            };
          })
      );
    };

    if (order?._id) {
      fetchTransactions();
    }
  }, [order?._id]);

  const isDuplicateQuery = useQuery(
    api.storeFront.onlineOrder.isDuplicateOrder,
    order?._id ? { id: order._id } : "skip"
  );

  const handleMarkAsVerified = async () => {
    try {
      await updateOrder({
        orderId: order?._id,
        update: {
          hasVerifiedPayment: true,
        },
      });
      toast.success("Order marked as verified");
    } catch (error) {
      toast.error("Failed to mark order as verified");
    }
  };

  const handleMarkPaymentCollected = async () => {
    try {
      await updateOrder({
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
      });
      toast.success("Payment marked as collected");
    } catch (error) {
      toast.error("Failed to mark payment as collected");
    }
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
      className="h-auto w-full"
      header={<p className="text-sm text-sm text-muted-foreground">Payment</p>}
    >
      <div className="py-4">
        <div className="space-y-4">
          {/* Payment Method Display */}
          <div className="flex items-center gap-8">
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

            {/* Payment Status Badges */}
            {isPODOrder ? (
              // POD Payment Status
              <div className="flex items-center gap-4">
                {order.paymentCollected ? (
                  <Badge
                    variant="outline"
                    className="bg-green-50 text-green-600 flex items-center gap-2"
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
              <div>
                {order.hasVerifiedPayment ? (
                  <VerifiedBadge
                    status={`Paid ${formatter.format(amountPaid / 100)}`}
                    withCheck={false}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="text-yellow-600 bg-yellow-50"
                    >
                      <p className="text-xs">Not verified</p>
                    </Badge>
                    <Button variant="link" onClick={handleMarkAsVerified}>
                      Mark as verified
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Payment Details */}
          {!isPODOrder && (
            <div className="space-y-4">
              <p className="text-sm">{`Account ending in ${paymentMethod?.last4}`}</p>
            </div>
          )}

          {/* Reference Information */}
          <div className="flex items-center gap-8">
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
          </div>

          {!isPODOrder && externalTransactions.length > 0 && (
            <div className="space-y-4 pt-8">
              <p className="text-sm text-sm text-muted-foreground">
                Payment history
              </p>
              <div className="space-y-8">
                {externalTransactions.map((transaction) => (
                  <ExternalTransaction
                    key={transaction.id}
                    transaction={transaction}
                  />
                ))}
              </div>
            </div>
          )}

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
