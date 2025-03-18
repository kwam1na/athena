import { ColumnDef } from "@tanstack/react-table";

import { DataTableColumnHeader } from "./data-table-column-header";
import { Link } from "@tanstack/react-router";
import { PromoCode } from "~/types";
import { slugToWords } from "~/src/lib/utils";

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
        >
          <strong>{row.original.discountValue}</strong> off {span}
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];
