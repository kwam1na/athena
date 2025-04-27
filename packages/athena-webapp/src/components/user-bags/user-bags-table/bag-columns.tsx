import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { Link } from "@tanstack/react-router";
import { capitalizeWords } from "~/convex/utils";
import { getRelativeTime } from "~/src/lib/utils";
import { Bag, BagItem } from "~/types";
import { User } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/tooltip";
import { getOrigin } from "~/src/lib/navigationUtils";

export const bagColumns: ColumnDef<Bag>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Bag" />
    ),
    cell: ({ row }) => {
      const bag = row.original;

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/bags/$bagId"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            bagId: bag._id,
          })}
          search={{ o: getOrigin() }}
          className="flex items-center gap-8"
        >
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              {bag.items.slice(0, 3).map((item: any) => (
                <div key={item._id} className="relative">
                  {item.productImage ? (
                    <img
                      alt="Uploaded image"
                      className={`aspect-square w-12 h-12 rounded-md object-cover`}
                      src={item.productImage}
                    />
                  ) : (
                    <div className="w-12 h-12 bg-gray-100 rounded-md" />
                  )}
                  <div className="absolute -top-2 -right-2 bg-primary/70 text-primary-foreground text-xs w-4 h-4 rounded-full flex items-center justify-center">
                    {item.quantity}
                  </div>
                </div>
              ))}
              {bag?.items && bag?.items?.length > 3 && (
                <div className="h-12 w-12 bg-gray-100 rounded-sm flex items-center justify-center">
                  <span className="text-gray-600">+{bag.items.length - 3}</span>
                </div>
              )}
            </div>
            <p className="font-medium">{(row.original as any).total}</p>
          </div>
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  // {
  //   accessorKey: "total",
  //   header: ({ column }) => (
  //     <DataTableColumnHeader column={column} title="Total" />
  //   ),
  //   cell: ({ row }) => {
  //     return <p>{row.getValue("total")}</p>;
  //   },
  //   enableSorting: false,
  //   enableHiding: false,
  // },
  {
    accessorKey: "user",
    header: ({ column }) => <DataTableColumnHeader column={column} title="" />,
    cell: ({ row }) => {
      const item = row.original;

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/users/$userId"
          params={(p) => ({
            ...p,
            orgUrlSlug: p.orgUrlSlug!,
            storeUrlSlug: p.storeUrlSlug!,
            userId: item.storeFrontUserId,
          })}
          search={{ o: getOrigin() }}
          className="flex items-center gap-2"
        >
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
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "creationTime",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Updated" />
    ),
    cell: ({ row }) => {
      const item = row.original;

      return (
        <p className="text-muted-foreground">
          {getRelativeTime(item.updatedAt)}
        </p>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];
