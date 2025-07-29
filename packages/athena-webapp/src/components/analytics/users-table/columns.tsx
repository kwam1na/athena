import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { formatUserId } from "~/src/lib/utils";
import { Sparkle, UserRoundCheck, User } from "lucide-react";

import { Link } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";
import { StoreFrontUser } from "~/types";
import { Badge } from "../../ui/badge";

export type User = StoreFrontUser & {
  isNew: boolean;
};

export const columns: ColumnDef<User>[] = [
  {
    accessorKey: "email",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Users" />
    ),
    cell: ({ row }) => {
      const user = row.original;

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/users/$userId"
          params={(p) => ({
            ...p,
            orgUrlSlug: p.orgUrlSlug!,
            storeUrlSlug: p.storeUrlSlug!,
            userId: user._id,
          })}
          search={{ o: getOrigin() }}
          className="flex items-center gap-3"
        >
          <div className="flex items-center justify-center w-8 h-8 bg-muted rounded-full">
            <User className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <div className="space-y-2">
              <span className="font-medium">
                {user.email || formatUserId(user._id)}
              </span>

              <Badge
                variant="outline"
                className={
                  user.isNew
                    ? "bg-blue-50 border-blue-50 text-blue-500 flex items-center gap-1 w-fit"
                    : "bg-green-50 border-green-50 text-green-600 flex items-center gap-1 w-fit"
                }
              >
                {user.isNew && <Sparkle className="w-3 h-3" />}
                {!user.isNew && <UserRoundCheck className="w-3 h-3" />}
                {user.isNew ? "New" : "Returning"}
              </Badge>
            </div>
          </div>
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];
