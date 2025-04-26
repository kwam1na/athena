import { Check, Tag, TriangleAlert } from "lucide-react";
import View from "../View";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import { currencyFormatter } from "~/src/lib/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { Badge } from "../ui/badge";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";

export function OrderDetailsView() {
  const { order } = useOnlineOrder();
  const { activeStore } = useGetActiveStore();

  const isDuplicateQuery = useQuery(
    api.storeFront.onlineOrder.isDuplicateOrder,
    order?._id ? { id: order._id } : "skip"
  );

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

            {order.hasVerifiedPayment && (
              <Badge variant={"outline"} className="bg-green-50 text-green-600">
                <p className="text-xs mr-2">Verified</p>
                <Check className="h-4 w-4" />
              </Badge>
            )}

            {!order.hasVerifiedPayment && (
              <Badge
                variant={"outline"}
                className="text-yellow-600 bg-yellow-50"
              >
                <p className="text-xs">Not verified</p>
              </Badge>
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
        </div>
      </div>
    </View>
  );
}
