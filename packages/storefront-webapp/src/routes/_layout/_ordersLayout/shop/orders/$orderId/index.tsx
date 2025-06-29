import { useStoreContext } from "@/contexts/StoreContext";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import placeholder from "@/assets/placeholder.png";
import { getProductName } from "@/lib/productUtils";
import { Separator } from "@/components/ui/separator";
import { DeliveryDetails } from "@/components/checkout/DeliveryDetails/DeliverySection";
import NotFound from "@/components/states/not-found/NotFound";
import { FadeIn } from "@/components/common/FadeIn";
import { capitalizeFirstLetter, formatDate, slugToWords } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  ArrowLeft,
  CircleCheck,
  Hourglass,
  RotateCcw,
  Tag,
  Truck,
  Award,
  Banknote,
  Smartphone,
  Clock,
} from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
} from "@/components/ui/breadcrumb";
import { WIGLUB_HAIR_STUDIO_LOCATION_URL } from "@/lib/constants";
import { getDiscountValue } from "@/components/checkout/utils";
import ImageWithFallback from "@/components/ui/image-with-fallback";
import { useOnlineOrderQueries } from "@/lib/queries/onlineOrder";
import { Button } from "@/components/ui/button";
import { GuestRewardsPrompt } from "@/components/rewards/GuestRewardsPrompt";
import { useUserQueries } from "@/lib/queries/user";
import { OrderPointsDisplay } from "@/components/rewards/OrderPointsDisplay";

export const Route = createFileRoute(
  "/_layout/_ordersLayout/shop/orders/$orderId/"
)({
  component: () => <OrderDetail />,
});

export function OrderNavigation() {
  const { origin } = useSearch({ strict: false });
  const navigate = useNavigate();

  return (
    <div className="container mx-auto xl:px-0 py-2 lg:py-8">
      <Button
        className="group px-0"
        variant={"clear"}
        onClick={() => {
          if (origin) {
            navigate({ to: "/shop/orders" });
          } else {
            window.history.back();
          }
        }}
      >
        <ArrowLeft className="w-4 h-4 mr-2 -me-1 ms-2 transition-transform group-hover:-translate-x-0.5" />
        <p>All orders</p>
      </Button>
    </div>
  );
}

const OrderSummary = ({ order }: { order: any }) => {
  const { formatter } = useStoreContext();

  const subtotal = order.amount / 100;

  const discountValue =
    order.discount?.totalDiscount || getDiscountValue(subtotal, order.discount);

  const total = subtotal - discountValue + (order?.deliveryFee || 0);

  // const subtotal = s - discountValue;
  const itemsCount = order.items.reduce(
    (total: number, item: any) => total + item.quantity,
    0
  );
  const isSingleItemOrder = itemsCount == 1;

  // Handle payment on delivery vs regular payment text
  const getPaymentText = () => {
    if (
      order.isPODOrder ||
      order.paymentMethod?.type === "payment_on_delivery"
    ) {
      const podMethod =
        order.podPaymentMethod ||
        order.paymentMethod?.podPaymentMethod ||
        "cash";
      const methodText = podMethod === "mobile_money" ? "mobile money" : "cash";

      if (order.paymentCollected) {
        return `Payment collected via ${methodText} upon delivery`;
      } else {
        return `Pay with ${methodText} when your order is delivered`;
      }
    }

    // Regular online payment
    return order.paymentMethod?.channel == "mobile_money"
      ? `Paid with ${order.paymentMethod?.bank} Mobile Money account ending in ${order.paymentMethod?.last4}`
      : `Paid with card ending in ${order.paymentMethod?.last4}`;
  };

  const discountText =
    order.discount?.type === "percentage"
      ? `${order.discount.value}%`
      : `${formatter.format(discountValue)}`;

  const discountSpan =
    order.discount?.span == "entire-order" ? "entire order" : "select items";

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
              {`${order.discount.code} - ${discountText}`} off {discountSpan}
            </strong>
          </div>
        )}

        {!order.storeFrontUserId.toString().startsWith("guest") && (
          <OrderPointsDisplay
            orderId={order._id}
            hasVerifiedPayment={order.hasVerifiedPayment}
          />
        )}
      </div>

      <p>{getPaymentText()}</p>
    </div>
  );
};

const OrderItem = ({
  item,
  formatter,
  isReviewable,
}: {
  item: any;
  formatter: Intl.NumberFormat;
  isReviewable: boolean;
}) => {
  const priceLabel = item.price
    ? formatter.format(item.price * item.quantity)
    : "Free";
  return (
    <div className="flex gap-8 text-sm">
      <ImageWithFallback
        src={item.productImage || placeholder}
        alt={"product image"}
        className="w-40 h-40 aspect-square object-cover rounded-sm"
      />

      <div className="space-y-8">
        <div className="space-y-2 text-sm">
          <p className="text-sm">{getProductName(item)}</p>
          <p className="text-sm text-muted-foreground">{priceLabel}</p>
          <p className="text-xs text-muted-foreground">{`x${item.quantity}`}</p>
        </div>

        {isReviewable && (
          <div>
            <Link
              to={`/shop/orders/$orderId/$orderItemId/review`}
              params={(p) => ({ orderId: p.orderId!, orderItemId: item._id })}
            >
              <p className="underline-offset-4 hover:underline">
                Write a review
              </p>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

const OrderItems = ({
  order,
  isReviewable,
}: {
  order: any;
  isReviewable: boolean;
}) => {
  const { formatter } = useStoreContext();
  return (
    <div className="grid grid-cols-1 gap-16">
      {order?.items.map((item: any, idx: number) => (
        <OrderItem
          formatter={formatter}
          item={item}
          key={idx}
          isReviewable={isReviewable}
        />
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

const OrderStatusSection = ({ data }: { data: any }) => {
  const isOrderOpen = data.status === "open";
  const isPODOrder =
    data.isPODOrder || data.paymentMethod?.type === "payment_on_delivery";
  const podMethod =
    data.podPaymentMethod || data.paymentMethod?.podPaymentMethod || "cash";

  // Don't show points for guest users
  const showPoints =
    !data.storeFrontUserId.toString().startsWith("guest") &&
    data.hasVerifiedPayment;

  return (
    <div className="space-y-8 text-sm">
      {isOrderOpen ? (
        <div className="flex items-center gap-2">
          <Hourglass className="w-3.5 h-3.5" />
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
        <p>{formatDate(data._creationTime)}</p>
      </div>

      <div className="flex items-center justify-between w-full lg:w-[30%]">
        <p>Order #</p>
        <p>{data?.orderNumber}</p>
      </div>

      {/* Show payment method for payment on delivery orders */}
      {isPODOrder && (
        <div className="flex items-center justify-between w-full lg:w-[30%]">
          <p>Payment method</p>
          <div className="flex items-center gap-1">
            {podMethod === "mobile_money" ? (
              <Smartphone className="w-3.5 h-3.5" />
            ) : (
              <Banknote className="w-3.5 h-3.5" />
            )}
            <p>
              {podMethod === "mobile_money"
                ? "Mobile Money on Delivery"
                : "Cash on Delivery"}
            </p>
          </div>
        </div>
      )}

      {/* Show payment status for payment on delivery orders */}
      {isPODOrder && (
        <div className="flex items-center justify-between w-full lg:w-[30%]">
          <p>Payment status</p>
          <div className="flex items-center gap-1">
            {data.paymentCollected ? (
              <>
                <CircleCheck className="w-3.5 h-3.5 text-green-600" />
                <p className="text-green-600">Payment Collected</p>
              </>
            ) : (
              <>
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                <p className="text-amber-600">Payment Due on Delivery</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Add reward points display for registered users */}
      {/* {showPoints && (
        <div className="flex items-center justify-between w-full lg:w-[30%]">
          <p>Reward points</p>
          <div className="flex items-center gap-1">
            <Award className="w-3.5 h-3.5 text-primary" />
            <OrderPointsDisplay
              orderId={data._id}
              hasVerifiedPayment={data.hasVerifiedPayment}
              compact={true}
            />
          </div>
        </div>
      )} */}
    </div>
  );
};

const OrderDetail = () => {
  const { orderId } = useParams({ strict: false });

  const { userId } = useAuth();

  const isGuest = userId === undefined;

  const onlineOrderQueries = useOnlineOrderQueries();

  const { data, isLoading } = useQuery(
    onlineOrderQueries.detail(orderId || "")
  );

  if (isLoading) return <div className="h-screen"></div>;

  if (!data) {
    return <NotFound />;
  }

  const isPickupOrder = data.deliveryMethod == "pickup";

  const getOrderMessage = () => {
    const isPODOrder =
      data.isPODOrder || data.paymentMethod?.type === "payment_on_delivery";
    const podMethod =
      data.podPaymentMethod || data.paymentMethod?.podPaymentMethod || "cash";
    const methodText = podMethod === "mobile_money" ? "mobile money" : "cash";

    const getNextPhase = () => {
      if (isPickupOrder) {
        return "ready for pickup";
      }

      return "out for delivery";
    };

    let message = `We're currently processing this order. You'll receive an email when it's ${getNextPhase()}.`;

    // Add payment on delivery specific messaging for payment instructions
    if (isPODOrder && !data.paymentCollected) {
      const paymentInstruction = isPickupOrder
        ? `Please have your ${methodText} ready when you pick up your order.`
        : `Please have your ${methodText} ready when we deliver your order.`;

      message += ` ${paymentInstruction}`;
    }

    switch (data.status) {
      case "open":
        break;

      case "ready-for-pickup":
        if (isPODOrder && !data.paymentCollected) {
          message = `Your order is ready for pickup! Visit our store anytime during working hours and pay with ${methodText} when you collect your items.`;
        } else {
          message = `Your order is ready for pickup. Visit our store to pick it up anytime during our working hours.`;
        }
        break;

      case "ready-for-delivery":
        if (isPODOrder && !data.paymentCollected) {
          message = `We're preparing your order for delivery. You'll receive an email when we send it out. Please have your ${methodText} ready when we arrive.`;
        } else {
          message = `We're preparing your order for delivery. You'll receive an email when we send it out.`;
        }
        break;

      case "out-for-delivery":
        if (isPODOrder && !data.paymentCollected) {
          message = `Your order is on its way! Our delivery courier will collect payment via ${methodText} when they arrive.`;
        } else {
          message = `Your order is out for delivery. Expect it soon!`;
        }
        break;

      case "picked-up":
        if (isPODOrder && data.paymentCollected) {
          message = `Order completed! You've picked up your items and payment has been processed. Thank you for shopping with us!`;
        } else {
          message = `Your order has been picked up. Thank you for shopping with us!`;
        }
        break;

      case "delivered":
        if (isPODOrder && data.paymentCollected) {
          message = `Order completed! Your items have been delivered and payment has been processed. Thank you for shopping with us!`;
        } else {
          message = `Your order has been delivered. Thank you for shopping with us!`;
        }
        break;

      case "refunded":
        message = `Your order has been refunded. Please allow 7-10 business days for the refund to reflect in your account.`;
        break;

      default:
        break;
    }

    return message;
  };

  const isReviewable = [
    "delivered",
    "picked-up",
    "refunded",
    "delivered",
    "refunded",
  ].includes(data.status);

  return (
    <FadeIn className="space-y-24 lg:space-y-40 py-8 pb-32 w-full container mx-auto max-w-[1024px] px-6 xl:px-0">
      <div className="space-y-16">
        <OrderNavigation />

        <OrderStatusSection data={data} />

        {isGuest && data && data.hasVerifiedPayment && (
          <GuestRewardsPrompt
            orderAmount={data.amount}
            orderEmail={data.customerDetails.email}
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 text-sm">
        <p>{getOrderMessage()}</p>

        <OrderItems order={data} isReviewable={isReviewable} />
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
