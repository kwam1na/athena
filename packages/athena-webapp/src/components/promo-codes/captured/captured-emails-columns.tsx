import { ColumnDef } from "@tanstack/react-table";
import { Offer } from "~/types";
import { DataTableColumnHeader } from "../../base/table/data-table-column-header";
import { formatUserId, getRelativeTime } from "~/src/lib/utils";
import { formatDate } from "~/convex/utils";
import { Link } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";

export const capturedEmailsColumns: ColumnDef<Offer>[] = [
  {
    accessorKey: "email",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Email" />
    ),
    cell: ({ row }) => {
      const r = row.original;
      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/users/$userId"
          params={(p) => ({
            ...p,
            orgUrlSlug: p.orgUrlSlug!,
            storeUrlSlug: p.storeUrlSlug!,
            userId: r.storeFrontUserId,
          })}
          search={{
            o: getOrigin(),
          }}
          className="flex space-x-2"
        >
          <span className="font-medium">{row.getValue("email")}</span>
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "_creationTime",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Captured" />
    ),
    cell: ({ row }) => {
      return (
        <div className="flex space-x-2">
          <span className="text-muted-foreground">
            {getRelativeTime(row.getValue("_creationTime"))}
          </span>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];
