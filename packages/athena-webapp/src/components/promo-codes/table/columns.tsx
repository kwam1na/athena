import { ColumnDef } from "@tanstack/react-table";

import { DataTableColumnHeader } from "./data-table-column-header";
import {
  capitalizeFirstLetter,
  getRelativeTime,
  slugToWords,
} from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { OnlineOrder } from "~/types";
import { CheckCircle2, Circle, CircleDashed, RotateCcw } from "lucide-react";

export const columns: ColumnDef<any>[] = [
  {
    accessorKey: "orderNumber",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Product" />
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
      <DataTableColumnHeader column={column} title="Code" />
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
  // {
  //   accessorKey: "_creationTime",
  //   header: ({ column }) => (
  //     <DataTableColumnHeader column={column} title="Placed" />
  //   ),
  //   cell: ({ row }) => (
  //     <Link
  //       to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
  //       params={(prev) => ({
  //         ...prev,
  //         orgUrlSlug: prev.orgUrlSlug!,
  //         storeUrlSlug: prev.storeUrlSlug!,
  //         orderSlug: row.original._id,
  //       })}
  //     >
  //       <div>{getRelativeTime(row.getValue("_creationTime"))}</div>
  //     </Link>
  //   ),
  // },
];
