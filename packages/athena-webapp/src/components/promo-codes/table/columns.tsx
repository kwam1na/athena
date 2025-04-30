import { ColumnDef } from "@tanstack/react-table";

import { DataTableColumnHeader } from "./data-table-column-header";
import { Link } from "@tanstack/react-router";
import { PromoCode } from "~/types";
import { slugToWords } from "~/src/lib/utils";
import { getOrigin } from "~/src/lib/navigationUtils";
import { Badge } from "../../ui/badge";

export const columns: ColumnDef<PromoCode>[] = [
  {
    accessorKey: "code",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Promo code" />
    ),
    cell: ({ row }) => {
      const code = row.original;
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
            <Badge
              variant="outline"
              className={`rounded-md px-2 py-1 ${
                code.active
                  ? "bg-green-50 text-green-600"
                  : "bg-red-50 text-red-600"
              }`}
            >
              <p>{code.active ? "Active" : "Inactive"}</p>
            </Badge>

            {code.autoApply && (
              <Badge variant="outline" className={`rounded-md px-2 py-1`}>
                <p className="text-muted-foreground">Auto-applied</p>
              </Badge>
            )}
          </Link>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "discountValue",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Discount" />
    ),
    cell: ({ row }) => {
      const span = slugToWords(row.original.span);
      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/promo-codes/$promoCodeSlug"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            promoCodeSlug: row.original._id,
          })}
          search={{ o: getOrigin() }}
        >
          <strong>{row.original.discountValue}</strong> off {span}
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];
