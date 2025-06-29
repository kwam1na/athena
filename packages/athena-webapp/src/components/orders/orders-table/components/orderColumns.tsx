import { ColumnDef } from "@tanstack/react-table";

import { DataTableColumnHeader } from "./data-table-column-header";
import {
  capitalizeFirstLetter,
  getRelativeTime,
  slugToWords,
} from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { OnlineOrder } from "~/types";
import {
  CheckCircle2,
  Circle,
  CircleDashed,
  RotateCcw,
  Banknote,
  Smartphone,
  Clock,
  CheckIcon,
  AlertCircleIcon,
  CheckCircle,
} from "lucide-react";
import { getOrderState } from "../../../orders/utils";
import { OrderStatus } from "../../OrderStatus";
import { ProductStatus } from "~/src/components/product/ProductStatus";
import { Badge } from "~/src/components/ui/badge";
import { getOrigin } from "~/src/lib/navigationUtils";

export const orderColumns: ColumnDef<OnlineOrder>[] = [
  {
    accessorKey: "orderNumber",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Order" />
    ),
    cell: ({ row }) => {
      const s = window.location.pathname.split("/").pop();

      const order = row.original;

      return (
        <div className="flex space-x-2">
          <Link
            to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
            params={(prev) => ({
              ...prev,
              orgUrlSlug: prev.orgUrlSlug!,
              storeUrlSlug: prev.storeUrlSlug!,
              orderSlug: row.original._id,
            })}
            search={{ orderStatus: s, o: getOrigin() }}
            className="flex items-center gap-8"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{`#${row.getValue("orderNumber")}`}</span>
              {order.hasVerifiedPayment &&
                order.paymentMethod?.type !== "payment_on_delivery" && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                )}

              {!order.hasVerifiedPayment &&
                order.paymentMethod?.type !== "payment_on_delivery" && (
                  <AlertCircleIcon className="w-3.5 h-3.5 text-yellow-500" />
                )}
            </div>
          </Link>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => {
      const order = row.original;

      const amountRefunded =
        order?.refunds?.reduce((acc, refund) => acc + refund.amount, 0) || 0;

      const isPartiallyRefunded =
        amountRefunded > 0 && amountRefunded < (order as any).amountValue;

      let status: string = row.getValue("status");

      if (status == "refunded") {
        if (isPartiallyRefunded) {
          status = "partially refunded";
        }
      }

      const s = window.location.pathname.split("/").pop();

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            orderSlug: row.original._id,
          })}
          search={{ orderStatus: s, o: getOrigin() }}
        >
          <OrderStatus order={order} />
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    accessorKey: "customerDetails",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Customer" />
    ),
    cell: ({ row }) => {
      const customer = row.getValue("customerDetails") as Record<string, any>;
      const s = window.location.pathname.split("/").pop();

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/users/$userId"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            userId: row.original.storeFrontUserId,
          })}
          search={{ orderStatus: s, o: getOrigin() }}
        >
          {customer?.email}
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "amount",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Amount" />
    ),
    cell: ({ row }) => {
      const s = window.location.pathname.split("/").pop();

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            orderSlug: row.original._id,
          })}
          search={{ orderStatus: s, o: getOrigin() }}
        >
          <div>{row.getValue("amount")}</div>
        </Link>
      );
    },
    sortingFn: (a, b) => {
      return (a.original as any).amountValue - (b.original as any).amountValue;
    },
  },
  {
    accessorKey: "deliveryMethod",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Delivery" />
    ),
    cell: ({ row }) => {
      const method = row.getValue("deliveryMethod");

      let content = <div>{row.getValue("deliveryMethod")}</div>;

      if (method == "delivery") {
        content = <div>Delivery</div>;
      }

      if (method == "pickup") {
        content = <div>Pickup</div>;
      }

      const s = window.location.pathname.split("/").pop();

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            orderSlug: row.original._id,
          })}
          search={{ orderStatus: row.original.status, o: getOrigin() }}
        >
          {content}
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    accessorKey: "paymentMethod",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Payment" />
    ),
    cell: ({ row }) => {
      const order = row.original;
      const isPODOrder =
        order.isPODOrder || order.paymentMethod?.type === "payment_on_delivery";
      const podMethod =
        order.podPaymentMethod ||
        order.paymentMethod?.podPaymentMethod ||
        "cash";

      const s = window.location.pathname.split("/").pop();

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            orderSlug: row.original._id,
          })}
          search={{ orderStatus: row.original.status, o: getOrigin() }}
        >
          <div className="flex flex-col">
            {isPODOrder ? (
              <>
                <span className="text-xs">
                  {podMethod === "mobile_money" ? "Mobile Money" : "Cash"}
                </span>
                <span className="text-xs text-muted-foreground">
                  On Delivery
                </span>
              </>
            ) : (
              <>
                <span className="text-xs">
                  {order.paymentMethod?.channel === "mobile_money"
                    ? "Mobile Money"
                    : "Card"}
                </span>
                <span className="text-xs text-muted-foreground">Online</span>
              </>
            )}
          </div>
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
    filterFn: (row, id, value) => {
      const order = row.original;
      const isPODOrder =
        order.isPODOrder || order.paymentMethod?.type === "payment_on_delivery";
      return value.includes(isPODOrder ? "pod" : "online");
    },
  },
  {
    accessorKey: "_creationTime",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Placed" />
    ),
    cell: ({ row }) => {
      const s = window.location.pathname.split("/").pop();

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            orderSlug: row.original._id,
          })}
          search={{ orderStatus: s, o: getOrigin() }}
        >
          <p className="text-muted-foreground">
            {getRelativeTime(row.getValue("_creationTime"))}
          </p>
        </Link>
      );
    },
  },
];
