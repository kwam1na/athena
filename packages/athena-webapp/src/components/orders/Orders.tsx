import { ShoppingBag } from "lucide-react";
import { OnlineOrder, Store } from "~/types";
import { DataTable } from "../products/products-table/components/data-table";
import { EmptyState } from "../states/empty/empty-state";
import { OrderDataTable } from "./orders-table/components/data-table";
import { orderColumns } from "./orders-table/components/orderColumns";

export default function Orders({
  store,
  orders,
}: {
  store: Store;
  orders: OnlineOrder[];
}) {
  return (
    <div className="container mx-auto">
      {orders && orders.length > 0 && (
        <div className="py-8">
          <OrderDataTable data={orders} columns={orderColumns} />
        </div>
      )}
      {orders && orders.length == 0 && (
        <EmptyState
          icon={<ShoppingBag className="w-16 h-16 text-muted-foreground" />}
          text={
            <div className="flex gap-1 text-sm">
              <p className="text-muted-foreground">No orders received for</p>
              <p className="font-medium">{store.name}</p>
            </div>
          }
        />
      )}
    </div>
  );
}
