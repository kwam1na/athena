import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import placeholder from "@/assets/placeholder.png";
import { EmptyState } from "@/components/states/empty/empty-state";
import { motion } from "framer-motion";
import { capitalizeFirstLetter, formatDate, slugToWords } from "@/lib/utils";
import { getOrderAmount } from "@/components/checkout/utils";
import ImageWithFallback from "@/components/ui/image-with-fallback";
import { useOnlineOrderQueries } from "@/lib/queries/onlineOrder";
import { OnlineOrder } from "@athena/webapp";
import { FadeIn } from "@/components/common/FadeIn";
import { Badge } from "@/components/ui/badge";
import { Banknote, Smartphone, Clock, CircleCheck } from "lucide-react";

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
  const amount = getOrderAmount({
    discount: order?.discount,
    deliveryFee: order?.deliveryFee || 0,
    subtotal: order.amount,
  });

  const isOrderOpen = order.status == "open";
  const isPODOrder =
    order.isPODOrder || order.paymentMethod?.type === "payment_on_delivery";
  const podMethod =
    order.podPaymentMethod || order.paymentMethod?.podPaymentMethod || "cash";

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
          {isPODOrder && (
            <Badge
              variant="outline"
              className={`flex items-center gap-1 ${
                order.paymentCollected
                  ? "text-green-600 border-green-200"
                  : "text-amber-600 border-amber-200"
              }`}
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
            </Badge>
          )}
        </div>
        <p>{formatDate(order._creationTime)}</p>
      </div>

      <div className="flex items-center gap-4">
        <p>{formatter.format(amount / 100)}</p>
        <Link to="/shop/orders/$orderId" params={{ orderId: order._id }}>
          <Button variant={"link"}>View</Button>
        </Link>
      </div>

      <div className="hidden md:flex gap-4">
        {order?.items?.slice(0, 3).map((item: any, idx: number) => (
          <div key={idx} className="h-32 w-32">
            <ImageWithFallback
              src={item.productImage || placeholder}
              alt={"product image"}
              className="aspect-square object-cover rounded-sm"
            />
          </div>
        ))}
        {order?.items && order?.items?.length > 3 && (
          <div className="h-32 w-32 bg-accent2/40 rounded-sm flex items-center justify-center">
            <span className="text-gray-600">+{order.items.length - 3}</span>
          </div>
        )}
      </div>

      <div className="block md:hidden grid grid-cols-3 gap-4">
        {order?.items &&
          order?.items.slice(0, 2).map((item: any, idx: number) => (
            <div key={idx} className="h-32 w-32">
              <ImageWithFallback
                src={item.productImage || placeholder}
                alt={"product image"}
                className="aspect-square object-cover rounded-sm"
              />
            </div>
          ))}
        {order?.items && order?.items.length > 2 && (
          <div className="h-32 w-32 bg-accent2/40 rounded-sm flex items-center justify-center">
            <span className="text-gray-600">+{order.items.length - 2}</span>
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

  if (isLoading) return <div className="h-screen"></div>;

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

  if (isLoading) return <div className="h-screen"></div>;

  return (
    <FadeIn className="pb-56 space-y-8 lg:space-y-24">
      <div className="w-full bg-accent5">
        <div className="container mx-auto max-w-[1024px] space-y-4">
          <div className="flex items-center border-b py-2 px-6 lg:px-0">
            <p className="text-lg font-light">Orders</p>
          </div>
        </div>
      </div>

      <div className="container mx-auto max-w-[1024px] px-6 xl:px-0">
        <Orders />
      </div>
    </FadeIn>
  );
};
