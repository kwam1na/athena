import { Check, Circle, Tag, TriangleAlert } from "lucide-react";
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
        <div className="pt-2">
          <Circle
            className={`w-2 h-2 ${statusColor[transaction.status as keyof typeof statusColor]}`}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p
              className={`text-sm ${statusColor[transaction.status as keyof typeof statusColor]}`}
            >
              {capitalizeFirstLetter(transaction.status)}
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
                order?.checkoutSessionId &&
              transaction.reference !== order?.externalReference
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

  if (!order || !activeStore) return null;

  const { paymentMethod } = order;

  const paymentChannel =
    paymentMethod?.channel == "mobile_money" ? "Mobile Money" : "Card";

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={<p className="text-sm text-sm text-muted-foreground">Payment</p>}
    >
      <div className="py-4">
        <div className="space-y-4">
          <div className="flex items-center gap-8">
            <div className="space-y-2">
              <p className="text-sm">{`${paymentMethod?.bank} ${paymentChannel}`}</p>
            </div>

            {order.hasVerifiedPayment && <VerifiedBadge status="Verified" />}

            {!order.hasVerifiedPayment && (
              <div>
                <Badge
                  variant={"outline"}
                  className="text-yellow-600 bg-yellow-50"
                >
                  <p className="text-xs">Not verified</p>
                </Badge>
                <Button variant={"link"} onClick={handleMarkAsVerified}>
                  Mark as verified
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <p className="text-sm">{`Account ending in ${paymentMethod?.last4}`}</p>
          </div>

          <div className="flex items-center gap-8">
            <p className="text-sm">
              External payment reference <b>{order?.externalReference}</b>
            </p>

            {isDuplicateQuery && (
              <Badge variant={"outline"} className="bg-gray-50 text-gray-600">
                <TriangleAlert className="h-4 w-4 mr-2" />
                <p className="text-xs">Duplicate order</p>
              </Badge>
            )}
          </div>

          {externalTransactions.length > 0 && (
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
        </div>
      </div>
    </View>
  );
}
