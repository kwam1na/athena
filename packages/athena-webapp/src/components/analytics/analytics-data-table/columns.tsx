import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { Link } from "@tanstack/react-router";
import { capitalizeWords } from "~/convex/utils";
import { getRelativeTime } from "~/src/lib/utils";
import { Analytic, BagItem } from "~/types";
import { Computer, Monitor, Phone, Smartphone, User } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/tooltip";

export const columns: ColumnDef<Analytic>[] = [
  {
    accessorKey: "action",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Action" />
    ),
    cell: ({ row }) => {
      const item = row.original;

      return <p>{item.action}</p>;
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "origin",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Origin" />
    ),
    cell: ({ row }) => {
      const item = row.original;

      return <p>{item.origin}</p>;
    },
    enableSorting: false,
    enableHiding: false,
  },
  // {
  //   accessorKey: "product",
  //   header: ({ column }) => (
  //     <DataTableColumnHeader column={column} title="Product" />
  //   ),
  //   cell: ({ row }) => {
  //     const item = row.original;

  //     return <p>{item.data.product}</p>;
  //   },
  //   enableSorting: false,
  //   enableHiding: false,
  // },
  {
    accessorKey: "device",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Device" />
    ),
    cell: ({ row }) => {
      const item = row.original;

      if (item.device === "desktop") {
        return <Monitor className="w-4 h-4" />;
      }

      if (item.device === "mobile") {
        return <Smartphone className="w-4 h-4" />;
      }
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "user",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="User" />
    ),
    cell: ({ row }) => {
      const item = row.original;

      return (
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <User className="w-4 h-4" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{item.storeFrontUserId}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "creationTime",
    header: ({ column }) => <DataTableColumnHeader column={column} title="" />,
    cell: ({ row }) => {
      const item = row.original;

      return <p>{getRelativeTime(item._creationTime)}</p>;
    },
    enableSorting: false,
    enableHiding: false,
  },
];
