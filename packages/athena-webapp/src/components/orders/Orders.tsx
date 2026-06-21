import { ShoppingBag } from "lucide-react";
import { OnlineOrder } from "~/types";
import { EmptyState } from "../states/empty/empty-state";
import { OrderDataTable } from "./orders-table/components/data-table";
import { orderColumns } from "./orders-table/components/orderColumns";
import { slugToWords } from "~/src/lib/utils";

export type FormattedOnlineOrder = Omit<OnlineOrder, "amount"> & {
  amount: string;
  amountValue: number;
};

export default function Orders({
  status,
  orders,
}: {
  status: string;
  orders: FormattedOnlineOrder[];
}) {
  return (
    <section>
      {orders && orders.length > 0 && (
        <div>
          <OrderDataTable
            data={orders as unknown as OnlineOrder[]}
            columns={orderColumns}
            tableId="orders"
          />
        </div>
      )}
      {orders && orders.length == 0 && (
        <div className="flex items-center justify-center min-h-[60vh] w-full">
          <EmptyState
            icon={<ShoppingBag className="w-16 h-16 text-muted-foreground" />}
            title={
              <div className="flex gap-1 text-sm">
                <p className="text-muted-foreground">
                  No <b>{status == "all" ? "" : slugToWords(status)}</b> orders
                </p>
              </div>
            }
          />
        </div>
      )}
    </section>
  );
}
