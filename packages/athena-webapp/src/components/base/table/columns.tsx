import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { Link } from "@tanstack/react-router";
import { PromoCode } from "~/types";
import { getOrigin } from "~/src/lib/navigationUtils";

export const columns: ColumnDef<PromoCode>[] = [
  {
    accessorKey: "code",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Promo code" />
    ),
    cell: ({ row }) => {
      return (
        <div className="flex space-x-2">
          <Link
            to="/$orgUrlSlug/store/$storeUrlSlug/promo-codes/$promoCodeSlug"
            params={(prev) => ({
              ...prev,
              orgUrlSlug: prev.orgUrlSlug!,
              storeUrlSlug: prev.storeUrlSlug!,
              promoCodeSlug: row.original._id,
            })}
            search={{ o: getOrigin() }}
            className="flex items-center gap-8"
          >
            <span className="font-medium">{row.getValue("code")}</span>
          </Link>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];
