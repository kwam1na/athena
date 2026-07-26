import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import placeholder from "@/assets/placeholder.png";
import { EmptyState } from "@/components/states/empty/empty-state";
import { motion } from "framer-motion";
import { capitalizeFirstLetter, formatDate, slugToWords } from "@/lib/utils";
import { getOrderAmount } from "@/components/checkout/utils";
import { useOnlineOrderQueries } from "@/lib/queries/onlineOrder";
import { OnlineOrder } from "@athena/webapp";
import { FadeIn } from "@/components/common/FadeIn";
import { Badge } from "@/components/ui/badge";
import { Banknote, Smartphone, Clock, CircleCheck } from "lucide-react";
import { getStoreFallbackImageUrl } from "@/lib/storeConfig";
import { formatStoredAmount } from "@/lib/currency";
import { StatusBadge } from "@/components/ui/status-badge";
import { StorefrontImage } from "@/components/ui/storefront-image";
import { PageState } from "@/components/states/PageState";
import { StorefrontPage } from "@/components/common/StorefrontPage";

export const Route = createFileRoute("/_layout/_ordersLayout/shop/orders/")({
  component: () => <Purchases />,
});

const OrderItem = ({
  order,
  formatter,
}: {
  order: OnlineOrder;
  formatter: Intl.NumberFormat;
}) => {
  const items =
    order.items?.map((item) => ({
      productSkuId: item.productSkuId,
      quantity: item.quantity,
      price: item.price,
    })) || [];

  const { amountCharged } = getOrderAmount({
    items,
    discount: order?.discount as any,
    deliveryFee: order?.deliveryFee || 0,
    subtotal: order.amount,
  });

  const isOrderOpen = order.status == "open";
  const isPODOrder =
    order.isPODOrder || order.paymentMethod?.type === "payment_on_delivery";
  const podMethod =
    order.podPaymentMethod || order.paymentMethod?.podPaymentMethod || "cash";

  const { store } = useStoreContext();
  const fallbackImageUrl = getStoreFallbackImageUrl(store);

  return (
    <div className="space-y-8 text-sm">
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {isOrderOpen ? (
            <strong>Processing</strong>
          ) : (
            <strong>{capitalizeFirstLetter(slugToWords(order.status))}</strong>
          )}

          {/* Show payment on delivery badge */}
          {isPODOrder && (
            <Badge variant="outline" className="flex items-center gap-1">
              {podMethod === "mobile_money" ? (
                <Smartphone className="w-3 h-3" />
              ) : (
                <Banknote className="w-3 h-3" />
              )}
              <span className="text-xs">
                {podMethod === "mobile_money"
                  ? "Mobile Money on Delivery"
                  : "Cash on Delivery"}
              </span>
            </Badge>
          )}

          {/* Show payment status for POD orders */}
          {isPODOrder && order.status !== "cancelled" && (
            <StatusBadge
              tone={order.paymentCollected ? "success" : "warning"}
              showIcon={false}
            >
              {order.paymentCollected ? (
                <>
                  <CircleCheck className="w-3 h-3" />
                  <span className="text-xs">Paid</span>
                </>
              ) : (
                <>
                  <Clock className="w-3 h-3" />
                  <span className="text-xs">Payment Pending</span>
                </>
              )}
            </StatusBadge>
          )}
        </div>
        <p>{formatDate(order._creationTime)}</p>
      </div>

      <div className="flex items-center gap-4">
        <p>{formatStoredAmount(formatter, amountCharged)}</p>
        <Link to="/shop/orders/$orderId" params={{ orderId: order._id }}>
          <Button variant={"link"}>View</Button>
        </Link>
      </div>

      <div className="hidden md:flex gap-4">
        {order?.items?.slice(0, 3).map((item: any, idx: number) => (
          <div key={idx} className="h-32 w-32">
            <StorefrontImage
              src={item.productImage || placeholder}
              fallbackSrc={fallbackImageUrl}
              alt={item.productName || `Item from order ${order.orderNumber}`}
              aspectRatio="1 / 1"
              wrapperClassName="h-32 w-32 rounded-sm"
            />
          </div>
        ))}
        {order?.items && order?.items?.length > 3 && (
          <div className="flex h-32 w-32 items-center justify-center rounded-sm bg-selection">
            <span className="text-selection-foreground">+{order.items.length - 3}</span>
          </div>
        )}
      </div>

      <div className="block md:hidden grid grid-cols-3 gap-4">
        {order?.items &&
          order?.items.slice(0, 2).map((item: any, idx: number) => (
            <div key={idx} className="h-32 w-32">
              <StorefrontImage
                src={item.productImage || placeholder}
                fallbackSrc={fallbackImageUrl}
                alt={item.productName || `Item from order ${order.orderNumber}`}
                aspectRatio="1 / 1"
                wrapperClassName="h-32 w-32 rounded-sm"
              />
            </div>
          ))}
        {order?.items && order?.items.length > 2 && (
          <div className="flex h-32 w-32 items-center justify-center rounded-sm bg-selection">
            <span className="text-selection-foreground">+{order.items.length - 2}</span>
          </div>
        )}
      </div>
    </div>
  );
};

const Orders = () => {
  const { formatter } = useStoreContext();

  const onlineOrderQueries = useOnlineOrderQueries();

  const { data, isLoading } = useQuery(onlineOrderQueries.list());

  if (isLoading) {
    return (
      <PageState
        state="loading"
        title="Loading your orders"
        description="We're getting your latest purchases."
        inline
      />
    );
  }

  if (data?.length === 0) {
    return (
      <EmptyState message="No orders yet. Let's change that!" cta="Shop Now" />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        transition: { ease: "easeOut", duration: 0.2 },
      }}
      className="space-y-24 lg:space-y-32"
    >
      {data?.map((order: any) => (
        <OrderItem key={order._id} order={order} formatter={formatter} />
      ))}
    </motion.div>
  );
};

const Purchases = () => {
  const onlineOrderQueries = useOnlineOrderQueries();

  const { data, isLoading } = useQuery(onlineOrderQueries.list());

  if (isLoading) {
    return (
      <PageState
        state="loading"
        title="Loading your orders"
        description="We're getting your latest purchases."
      />
    );
  }

  return (
    <StorefrontPage as="section" spacing="relaxed">
      <FadeIn className="space-y-12">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <Orders />
      </FadeIn>
    </StorefrontPage>
  );
};
