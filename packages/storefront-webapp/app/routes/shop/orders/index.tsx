import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { onlineOrderQueries } from "@/queries";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import placeholder from "@/assets/placeholder.png";
import { EmptyState } from "@/components/states/empty/empty-state";
import { motion } from "framer-motion";

export const Route = createFileRoute("/shop/orders/")({
  component: () => <Purchases />,
});

const OrderItem = ({
  order,
  formatter,
}: {
  order: any;
  formatter: Intl.NumberFormat;
}) => {
  const amount = order.amount / 100;

  return (
    <div className="space-y-8 text-sm">
      <div className="space-y-4">
        <p className="font-bold">Processing</p>
        <p>{new Date(order._creationTime).toDateString()}</p>
      </div>

      <div className="flex items-center gap-4">
        <p>{formatter.format(amount)}</p>
        <Link to="/shop/orders/$orderId" params={{ orderId: order._id }}>
          <Button variant={"link"}>View</Button>
        </Link>
      </div>

      <div className="flex gap-4">
        {order?.items.map((item: any, idx: number) => (
          <div key={idx} className="h-32 w-32">
            <img
              src={item.productImage || placeholder}
              alt={"product image"}
              className="aspect-square object-cover rounded-sm"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

const Orders = () => {
  const { userId, storeId, organizationId, formatter } = useStoreContext();

  const { data, isLoading } = useQuery(
    onlineOrderQueries.list({
      organizationId: organizationId,
      storeId: storeId,
      customerId: userId || "",
    })
  );

  if (isLoading) return null;

  if (data.length === 0) {
    return <EmptyState message="You haven't placed any orders." />;
  }

  console.log("orders -> ", data);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        transition: { ease: "easeOut", duration: 0.2 },
      }}
      className="space-y-40"
    >
      {data?.map((order: any) => (
        <OrderItem key={order._id} order={order} formatter={formatter} />
      ))}
    </motion.div>
  );
};
const Purchases = () => {
  return (
    <div className="container mx-auto px-4 space-y-40 py-12 pb-40">
      <h1 className="text-2xl font-light">Orders</h1>

      <Orders />
    </div>
  );
};