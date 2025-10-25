import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { formatUserId, getTimeRemaining } from "~/src/lib/utils";
import { User } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";
import { Doc, Id } from "~/convex/_generated/dataModel";
import { UserStatus } from "../../users/UserStatus";

export interface CheckoutSessionTableItem {
  startedAt: number;
  expiresAt: number;
  subtotal: string;
  user?: Doc<"storeFrontUser"> | Doc<"guest">;
}

export const columns: ColumnDef<CheckoutSessionTableItem>[] = [
  {
    accessorKey: "email",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="User" />
    ),
    cell: ({ row }) => {
      const combinedUser = row.original;
      const user = combinedUser.user;

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/users/$userId"
          params={(p) => ({
            ...p,
            orgUrlSlug: p.orgUrlSlug!,
            storeUrlSlug: p.storeUrlSlug!,
            userId: user?._id as string,
          })}
          search={{ o: getOrigin() }}
          className="flex items-center gap-3"
        >
          <div className="flex items-center justify-center w-8 h-8 bg-muted rounded-full">
            <User className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium">
                {user?.email || formatUserId(user?._id as string)}
              </span>
            </div>
            <div className="flex">
              <UserStatus
                creationTime={user?._creationTime as number}
                userId={user?._id as Id<"storeFrontUser"> | Id<"guest">}
              />
            </div>
          </div>
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "subtotal",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Bag subtotal" />
    ),
    cell: ({ row }) => {
      return <p>{row.original.subtotal}</p>;
    },
  },
  {
    accessorKey: "expiresAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Expires" />
    ),
    cell: ({ row }) => {
      return <p>{getTimeRemaining(row.original.expiresAt)}</p>;
    },
  },
];
