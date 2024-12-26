import { Link } from "@tanstack/react-router";
import View from "../View";
import { CustomerDetailsView } from "./CustomerDetailsView";
import { OrderDetailsView } from "./OrderDetailsView";
import { OrderItemsView } from "./OrderItemsView";
import { PickupDetailsView } from "./PickupDetailsView";
import { Button } from "../ui/button";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircledIcon,
} from "@radix-ui/react-icons";
import { Badge } from "../ui/badge";
import { AlertCircleIcon, Ban, RotateCcw, Store, Truck } from "lucide-react";
import {
  OnlineOrderProvider,
  useOnlineOrder,
} from "~/src/contexts/OnlineOrderContext";
import { LoadingButton } from "../ui/loading-button";
import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "~/convex/_generated/api";
import { getRelativeTime } from "~/src/lib/utils";
import { toast } from "sonner";

const Header = () => {
  const { order } = useOnlineOrder();

  const isDelivery = order?.deliveryMethod === "delivery";
  const isPickup = order?.deliveryMethod === "pickup";

  if (!order) return null;

  return (
    <div className="container mx-auto flex gap-2 h-[40px] items-center justify-between">
      <div className="flex gap-4 items-center">
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/orders"
          params={(prev) => ({
            ...prev,
            storeUrlSlug: prev.storeUrlSlug!,
            orgUrlSlug: prev.orgUrlSlug!,
          })}
          className="flex items-center gap-2"
        >
          <Button variant="ghost" className="h-8 px-2 lg:px-3 ">
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
        </Link>

        <p className="text-sm">{`Order #${order?.orderNumber}`}</p>

        <Badge className="rounded-lg" variant={"outline"}>
          <p className="text-muted-foreground">OPEN</p>
        </Badge>

        <p className="text-xs text-muted-foreground">
          {getRelativeTime(order._creationTime)}
        </p>
      </div>

      <div className="flex gap-4">
        <Button className="px-2 lg:px-3" variant="outline">
          <RotateCcw className="h-4 w-4 mr-2" />
          <p className="text-sm">Refund order</p>
        </Button>

        {isDelivery && (
          <Button className="px-2 lg:px-3">
            <Truck className="h-4 w-4 mr-2" />
            <p className="text-sm">Ready for delivery</p>
          </Button>
        )}

        {isPickup && (
          <Button className="px-2 lg:px-3">
            <Store className="h-4 w-4 mr-2" />
            <p className="text-sm">Ready for pickup</p>
          </Button>
        )}
      </div>
    </div>
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
        customerId: order.customerId,
        externalReference: order.externalReference,
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
    <div className="flex gap-2 items-center p-4 rounded-lg bg-yellow-50">
      <AlertCircleIcon className="h-4 w-4 text-yellow-800" />
      <div className="flex items-center">
        <p className="text-xs text-yellow-800">
          Payment for this order has not been verified.
        </p>
        <LoadingButton
          isLoading={isVerifyingPayment}
          onClick={handleVerifyPayment}
          variant={"link"}
          className="text-yellow-800"
        >
          <p className="text-xs underline">Verify payment</p>
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
      <View hideBorder hideHeaderBottomBorder header={<Header />}>
        <div className="container mx-auto h-full w-full p-8 space-y-8">
          <Alerts />
          <OrderDetailsView />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-8">
              <CustomerDetailsView />
              <PickupDetailsView />
            </div>

            <OrderItemsView />
          </div>
        </div>
      </View>
    </OnlineOrderProvider>
  );
};
