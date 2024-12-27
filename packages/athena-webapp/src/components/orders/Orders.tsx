import { PackageXIcon, ShoppingBag } from "lucide-react";
import { Link, useLoaderData } from "@tanstack/react-router";
import { PlusIcon } from "@radix-ui/react-icons";
import { StoreResponse } from "@/lib/schemas/store";
import { OnlineOrder, Product, Store } from "~/types";
import { Button } from "../ui/button";
import { columns } from "../products-table/components/columns";
import { DataTable } from "../products-table/components/data-table";
import { EmptyState } from "../states/empty/empty-state";
import { orderColumns } from "../products-table/components/orderColumns";

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
        <div className="p-8">
          <DataTable data={orders} columns={orderColumns} showToolbar={false} />
        </div>
      )}
      {orders && orders.length == 0 && (
        <EmptyState
          icon={<ShoppingBag className="w-16 h-16 text-muted-foreground" />}
          text={
            <div className="flex gap-1 text-sm">
              <p className="text-muted-foreground">No orders for</p>
              <p className="font-medium">{store.name}</p>
            </div>
          }
        />
      )}
    </div>
  );
}
