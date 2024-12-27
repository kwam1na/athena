import { ColumnDef } from "@tanstack/react-table";

import { Badge } from "../../ui/badge";

import placeholder from "../../../assets/placeholder.png";
import { DataTableColumnHeader } from "./data-table-column-header";
import { DataTableRowActions } from "./data-table-row-actions";
import { capitalizeFirstLetter, getRelativeTime } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { OnlineOrder } from "~/types";

export const orderColumns: ColumnDef<OnlineOrder>[] = [
  {
    accessorKey: "orderNumber",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Order" />
    ),
    cell: ({ row }) => {
      //   const sku = row.original.skus[0];

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
    cell: ({ row }) => <div>{row.getValue("amount")}</div>,
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "deliveryMethod",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Method" />
    ),
    cell: ({ row }) => {
      const method = row.getValue("deliveryMethod");

      if (method == "delivery") {
        return <div>Delivery</div>;
      }

      if (method == "pickup") {
        return <div>Pickup</div>;
      }

      return <div>{row.getValue("deliveryMethod")}</div>;
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => (
      <Badge variant="outline">
        {capitalizeFirstLetter(row.getValue("status"))}
      </Badge>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "_creationTime",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Placed" />
    ),
    cell: ({ row }) => (
      //   <div >{row.getValue("_creationTime")}</div>
      <div>{getRelativeTime(row.getValue("_creationTime"))}</div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
];
