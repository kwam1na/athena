import { ColumnDef } from "@tanstack/react-table";

import { DataTableColumnHeader } from "./data-table-column-header";
import {
  capitalizeFirstLetter,
  getRelativeTime,
  slugToWords,
} from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { OnlineOrder } from "~/types";
import { CheckCircle2, Circle, RotateCcw } from "lucide-react";
import { getOrderState } from "../../../orders/utils";

export const orderColumns: ColumnDef<OnlineOrder>[] = [
  {
    accessorKey: "orderNumber",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Orders" />
    ),
    cell: ({ row }) => {
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
            className="flex items-center gap-8"
          >
            <span className="font-medium">{`#${row.getValue("orderNumber")}`}</span>
          </Link>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "customerDetails",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Customer" />
    ),
    cell: ({ row }) => {
      const customer = row.getValue("customerDetails") as Record<string, any>;
      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            orderSlug: row.original._id,
          })}
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
    cell: ({ row }) => (
      <Link
        to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
          orderSlug: row.original._id,
        })}
      >
        <div>{row.getValue("amount")}</div>
      </Link>
    ),
    sortingFn: (a, b) => {
      return (a.original as any).amountValue - (b.original as any).amountValue;
    },
  },
  {
    accessorKey: "deliveryMethod",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Method" />
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

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            orderSlug: row.original._id,
          })}
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

      const { isOrderReady, hasOrderTransitioned } = getOrderState(order);

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            orderSlug: row.original._id,
          })}
        >
          <div className="flex items-center">
            {(isOrderReady || hasOrderTransitioned) && (
              <CheckCircle2 className="h-3 w-3 mr-2" />
            )}
            {status.includes("refunded") && (
              <RotateCcw className="h-3 w-3 mr-2" />
            )}
            {status.includes("open") && <Circle className="h-3 w-3 mr-2" />}
            <p>{capitalizeFirstLetter(slugToWords(status))}</p>
          </div>
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
    accessorKey: "_creationTime",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Placed" />
    ),
    cell: ({ row }) => (
      <Link
        to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
          orderSlug: row.original._id,
        })}
      >
        <div>{getRelativeTime(row.getValue("_creationTime"))}</div>
      </Link>
    ),
  },
];
