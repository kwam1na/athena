import { useStoreContext } from "@/contexts/StoreContext";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useParams } from "@tanstack/react-router";
import placeholder from "@/assets/placeholder.png";
import { getProductName } from "@/lib/productUtils";
import { Separator } from "@/components/ui/separator";
import { DeliveryDetails } from "@/components/checkout/DeliveryDetails/DeliverySection";
import NotFound from "@/components/states/not-found/NotFound";
import { FadeIn } from "@/components/common/FadeIn";
import { capitalizeFirstLetter, slugToWords } from "@/lib/utils";
import { CircleCheck, Hourglass, RotateCcw, Tag, Truck } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
} from "@/components/ui/breadcrumb";
import { WIGLUB_HAIR_STUDIO_LOCATION_URL } from "@/lib/constants";
import { getDiscountValue } from "@/components/checkout/utils";
import ImageWithFallback from "@/components/ui/image-with-fallback";
import { onlineOrderQueries } from "@/lib/queries/onlineOrder";

export const Route = createFileRoute(
  "/_layout/_ordersLayout/shop/orders/$orderId"
)({
  component: () => <OrderDetail />,
});

export function OrderNavigation() {
  return (
    <Breadcrumb className="container mx-auto xl:px-0 py-2 lg:py-8">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink onClick={() => window.history.back()}>
            <p className="text-xs cursor-pointer">Back</p>
          </BreadcrumbLink>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

const OrderSummary = ({ order }: { order: any }) => {
  const { formatter } = useStoreContext();

  const subtotal = order.amount / 100;

  const discountValue = getDiscountValue(subtotal, order.discount);

  const total = subtotal - discountValue + (order?.deliveryFee || 0);

  // const subtotal = s - discountValue;
  const itemsCount = order.items.reduce(
    (total: number, item: any) => total + item.quantity,
    0
  );
  const isSingleItemOrder = itemsCount == 1;

  const paymentText =
    order.paymentMethod?.channel == "mobile_money"
      ? `Paid with ${order.paymentMethod?.bank} Mobile Money account ending in ${order.paymentMethod?.last4}`
      : `Paid with card ending in ${order.paymentMethod?.last4}`;

  const discountText =
    order.discount?.type === "percentage"
      ? `${order.discount.value}%`
      : `${formatter.format(discountValue)}`;

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

        {Boolean(discountValue) && (
          <div className="grid grid-cols-2">
            <p className="text-sm">Discount</p>
            <p className="text-sm">{formatter.format(discountValue)}</p>
          </div>
        )}

        <div className="grid grid-cols-2">
          <p className="text-sm">Total</p>
          <p className="text-sm font-medium">{formatter.format(total)}</p>
        </div>

        {Boolean(discountValue) && (
          <div className="flex items-center gap-2">
            <Tag className="w-3 h-3" />
            <strong>
              {`${order.discount.code} - ${discountText}`} off entire order
            </strong>
          </div>
        )}
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
      <ImageWithFallback
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
            <p className="text-sm">2 Jungle Avenue, East Legon, Accra</p>
            <div>
              <a
                href={WIGLUB_HAIR_STUDIO_LOCATION_URL}
                target="_blank"
                className="font-medium underline"
              >
                See map and directions
              </a>
            </div>
          </div>
        )}
      </div>
    );
};

const OrderDetail = () => {
  const { orderId } = useParams({ strict: false });

  const { data, isLoading } = useQuery(
    onlineOrderQueries.detail(orderId || "")
  );

  if (isLoading) return <div className="h-screen"></div>;

  if (!data) {
    return <NotFound />;
  }

  const isPickupOrder = data.deliveryMethod == "pickup";

  const isOrderOpen = data.status == "open";

  const getOrderMessage = () => {
    const getNextPhase = () => {
      if (isPickupOrder) {
        return "ready for pickup";
      }

      return "out for delivery";
    };

    let message = `We're currently processing this order. You'll receive an email when it's ${getNextPhase()}.`;

    switch (data.status) {
      case "open":
        break;

      case "ready-for-pickup":
        message = `Your order is ready for pickup. Visit our store to pick it up anytime during our working hours.`;
        break;

      case "ready-for-delivery":
        message = `We're preparing your order for delivery. You'll receive an email when we send it out.`;
        break;

      case "out-for-delivery":
        message = `Your order is out for delivery. Expect it soon!`;
        break;

      case "picked-up":
        message = `Your order has been picked up. Thank you for shopping with us!`;
        break;

      case "delivered":
        message = `Your order has been delivered. Thank you for shopping with us!`;
        break;

      case "refunded":
        message = `Your order has been refunded. Please allow 7-10 business days for the refund to reflect in your account.`;
        break;

      default:
        break;
    }

    return message;
  };

  return (
    <FadeIn className="space-y-24 lg:space-y-40 py-8 pb-32 w-full">
      <div className="space-y-16">
        {/* <OrderNavigation /> */}

        <div className="space-y-8 text-sm">
          {isOrderOpen ? (
            <div className="flex items-center gap-2">
              {data.status == "open" && <Hourglass className="w-3.5 h-3.5" />}
              <p className="font-medium">Processing</p>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {data.status == "out-for-delivery" && (
                <Truck className="w-3.5 h-3.5" />
              )}

              {data.status == "refunded" && <RotateCcw className="w-3 h-3" />}

              {data.status == "picked-up" && (
                <CircleCheck className="w-3.5 h-3.5" />
              )}

              {data.status == "delivered" && (
                <CircleCheck className="w-3.5 h-3.5" />
              )}
              <p className="font-medium">
                {capitalizeFirstLetter(slugToWords(data.status))}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between w-full lg:w-[30%]">
            <p>Purchase date</p>
            <p>{new Date(data._creationTime).toDateString()}</p>
          </div>

          <div className="flex items-center justify-between w-full lg:w-[30%]">
            <p>Order #</p>
            <p>{data?.orderNumber}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 text-sm">
        <p>{getOrderMessage()}</p>

        <OrderItems order={data} />
      </div>

      <Separator className="bg-[#F6F6F6]" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
        <PickupDetails order={data} />

        <div className="space-y-12 text-sm">
          <p>Summary</p>
          <OrderSummary order={data} />
        </div>
      </div>
    </FadeIn>
  );
};
