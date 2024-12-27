import { useStoreContext } from "@/contexts/StoreContext";
import { onlineOrderQueries } from "@/queries";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import placeholder from "@/assets/placeholder.png";
import { getProductName } from "@/lib/productUtils";
import { Separator } from "@/components/ui/separator";
import { DeliveryDetails } from "@/components/checkout/DeliveryDetails/DeliverySection";
import { motion } from "framer-motion";
import NotFound from "@/components/states/not-found/NotFound";
import { FadeIn } from "@/components/common/FadeIn";

export const Route = createFileRoute("/shop/orders/$orderId")({
  component: () => <OrderDetail />,
});

const OrderSummary = ({ order }: { order: any }) => {
  const { formatter } = useStoreContext();

  const subtotal = order.amount / 100 - (order?.deliveryFee || 0);
  const itemsCount = order.items.reduce(
    (total: number, item: any) => total + item.quantity,
    0
  );
  const isSingleItemOrder = itemsCount == 1;

  const paymentText =
    order.paymentMethod?.channel == "mobile_money"
      ? `Paid with ${order.paymentMethod?.bank} Mobile Money ending in ${order.paymentMethod?.last4}`
      : `Paid with card ending in ${order.paymentMethod?.last4}`;

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div className="grid grid-cols-2">
          <p className="text-sm">
            {isSingleItemOrder ? `${itemsCount} item` : `${itemsCount} items`}
          </p>
        </div>

        {Boolean(order?.deliveryFee) && (
          <div className="grid grid-cols-2">
            <p className="text-sm">Delivery</p>
            <p className="text-sm">{formatter.format(order?.deliveryFee)}</p>
          </div>
        )}

        <div className="grid grid-cols-2">
          <p className="text-sm">Subtotal</p>
          <p className="text-sm">{formatter.format(subtotal)}</p>
        </div>

        <div className="grid grid-cols-2">
          <p className="text-sm">Total</p>
          <p className="text-sm font-bold">
            {formatter.format(order.amount / 100)}
          </p>
        </div>
      </div>

      <p>{paymentText}</p>
    </div>
  );
};

const OrderItem = ({
  item,
  formatter,
}: {
  item: any;
  formatter: Intl.NumberFormat;
}) => {
  return (
    <div className="flex gap-8 text-sm">
      <img
        src={item.productImage || placeholder}
        alt={"product image"}
        className="w-40 h-40 aspect-square object-cover rounded-sm"
      />

      <div className="space-y-2 text-sm">
        <p className="text-sm">{getProductName(item)}</p>
        <p className="text-sm text-muted-foreground">
          {formatter.format(item.price * item.quantity)}
        </p>
        <p className="text-xs text-muted-foreground">{`x${item.quantity}`}</p>
      </div>
    </div>
  );
};

const OrderItems = ({ order }: { order: any }) => {
  const { formatter } = useStoreContext();
  return (
    <div className="grid grid-cols-1 gap-16">
      {order?.items.map((item: any, idx: number) => (
        <OrderItem formatter={formatter} item={item} key={idx} />
      ))}
    </div>
  );
};

const PickupDetails = ({ order }: { order: any }) => {
  if (order.deliveryMethod == "delivery")
    return (
      <div className="space-y-12 text-sm">
        <p>Delivery details</p>
        {order.deliveryDetails && (
          <DeliveryDetails address={order.deliveryDetails} />
        )}
      </div>
    );

  if (order.deliveryMethod == "pickup")
    return (
      <div className="space-y-12 text-sm">
        <p>Store pickup</p>
        {order.pickupLocation && (
          <div className="space-y-4">
            <p className="text-sm">Wigclub Hair Studio</p>
            <p className="text-sm">2 Jungle Ave., East Legon</p>
          </div>
        )}
      </div>
    );
};

const OrderDetail = () => {
  const { orderId } = useParams({ strict: false });

  const { userId, storeId, organizationId } = useStoreContext();

  const { data, isLoading } = useQuery(
    onlineOrderQueries.detail({
      orderId: orderId || "",
      organizationId: organizationId,
      storeId: storeId,
      customerId: userId || "",
    })
  );

  if (isLoading) return null;

  if (!data) {
    return <NotFound />;
  }

  // console.log("order ->", data);
  const isPickupOrder = data.deliveryMethod == "pickup";

  const isOrderOpen = data.status == "open";

  const isOrderReady = data.status == "ready";

  const readyText = isPickupOrder
    ? "Ready for pickup"
    : "Preparing for delivery";

  const openText = isPickupOrder
    ? "We're currently processing this order. You'll receive an email when it's ready for pickup."
    : "We're currently processing this order. You'll receive an email when it's dispatched.";

  const preparingText = isPickupOrder
    ? "Your order is ready for pickup."
    : "Your order is being prepared for delivery.";

  return (
    <FadeIn className="container mx-auto space-y-40 py-8 pb-32 w-full">
      <div className="space-y-16">
        <div className="space-y-12">
          <Link to="/shop/orders" className="flex items-center gap-2">
            <ArrowLeftIcon className="w-4 h-4" />
            <h1 className="text-sm font-light">All purchases</h1>
          </Link>
          {/* <h1 className="text-sm font-light">Back to orders</h1> */}
        </div>

        <div className="space-y-8 text-sm">
          {isOrderOpen && <p className="font-bold">Processing</p>}

          {isOrderReady && <p className="font-bold">{readyText}</p>}

          <div className="flex items-center justify-between w-[30%]">
            <p>Purchase date</p>
            <p>{new Date(data._creationTime).toDateString()}</p>
          </div>

          <div className="flex items-center justify-between w-[30%]">
            <p>Order #</p>
            <p>{data?.orderNumber}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 text-sm">
        {isOrderOpen && <p>{openText}</p>}

        {isOrderReady && <p>{preparingText}</p>}

        <OrderItems order={data} />
      </div>

      <Separator className="bg-[#F6F6F6]" />

      <div className="grid grid-cols-2">
        <PickupDetails order={data} />

        <div className="space-y-12 text-sm">
          <p>Summary</p>
          <OrderSummary order={data} />
        </div>
      </div>
    </FadeIn>
  );
};
