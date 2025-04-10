import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { Link } from "@tanstack/react-router";
import { capitalizeWords } from "~/convex/utils";
import { getRelativeTime } from "~/src/lib/utils";
import { BagItem } from "~/types";
import { User } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/tooltip";

export const columns: ColumnDef<BagItem>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Product" />
    ),
    cell: ({ row }) => {
      const bagItem = row.original;

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            productSlug: bagItem.productId,
          })}
          className="flex items-center gap-8"
        >
          {bagItem.productImage ? (
            <img
              alt="Uploaded image"
              className={`aspect-square w-16 h-16 rounded-md object-cover`}
              src={bagItem.productImage}
            />
          ) : (
            <div className="aspect-square w-24 h-24 bg-gray-100 rounded-md" />
          )}
          <div className="flex flex-col gap-1">
            <span className="max-w-[500px] truncate font-medium">
              {capitalizeWords(bagItem.productName || "")}
            </span>
          </div>
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "quantity",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Quantity" />
    ),
    cell: ({ row }) => {
      const item = row.original;

      return <p>{item.quantity}</p>;
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
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4" />
                  <p className="text-sm font-medium">
                    {`User-${item.storeFrontUserId.slice(-5)}`}
                  </p>
                </div>
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
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Added" />
    ),
    cell: ({ row }) => {
      const item = row.original;

      return <p>{getRelativeTime(item._creationTime)}</p>;
    },
    enableSorting: false,
    enableHiding: false,
  },
];
