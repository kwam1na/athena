import { ColumnDef } from "@tanstack/react-table";
import { Link } from "@tanstack/react-router";
import { Banknote, CreditCardIcon, Smartphone } from "lucide-react";

import { DataTableColumnHeader } from "../../base/table/data-table-column-header";
import { getRelativeTime } from "~/src/lib/utils";
import { getOrigin } from "~/src/lib/navigationUtils";
import type { Id } from "~/convex/_generated/dataModel";

export type CompletedTransactionRow = {
  _id: Id<"posTransaction">;
  transactionNumber: string;
  formattedTotal: string;
  paymentMethodLabel: string;
  paymentMethod: string;
  cashierName: string | null;
  customerName: string | null;
  itemCount: number;
  completedAt: number;
};

const getPaymentMethodIcon = (paymentMethod: string) => {
  switch (paymentMethod) {
    case "cash":
      return <Banknote className="w-4 h-4" />;
    case "card":
      return <CreditCardIcon className="w-4 h-4" />;
    case "mobile_money":
      return <Smartphone className="w-4 h-4" />;
    default:
      return null;
  }
};

export const transactionColumns: ColumnDef<CompletedTransactionRow>[] = [
  {
    accessorKey: "transactionNumber",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Transaction" />
    ),
    cell: ({ row }) => {
      const count = row.original.itemCount;
      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            transactionId: row.original._id,
          })}
          search={{ o: getOrigin() }}
          className="flex items-center gap-2 text-foreground hover:text-primary"
        >
          <span className="font-medium">{`#${row.getValue<string>("transactionNumber")}`}</span>
          <span className="text-muted-foreground text-sm">
            {`${count} ${count === 1 ? "item" : "items"}`}
          </span>
        </Link>
      );
    },
    enableSorting: false,
  },
  {
    accessorKey: "formattedTotal",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Total" />
    ),
    cell: ({ row }) => (
      <Link
        to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
          transactionId: row.original._id,
        })}
        search={{ o: getOrigin() }}
        className="flex items-center gap-2"
      >
        <span>{row.original.formattedTotal}</span>
        <span className="capitalize text-muted-foreground text-sm">
          {getPaymentMethodIcon(row.original.paymentMethod)}
        </span>
      </Link>
    ),
    enableSorting: false,
  },
  {
    accessorKey: "cashierName",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Cashier" />
    ),
    cell: ({ row }) => (
      <Link
        to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
          transactionId: row.original._id,
        })}
        search={{ o: getOrigin() }}
        className="flex items-center gap-2"
      >
        <span>{row.original.cashierName ?? "N/A"}</span>
      </Link>
    ),
    enableSorting: false,
  },
  //   {
  //     accessorKey: "customerName",
  //     header: ({ column }) => (
  //       <DataTableColumnHeader column={column} title="Customer" />
  //     ),
  //     cell: ({ row }) => <span>{row.original.customerName ?? "Walk-in"}</span>,
  //     enableSorting: false,
  //   },
  {
    accessorKey: "completedAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Completed" />
    ),
    cell: ({ row }) => (
      <Link
        to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
          transactionId: row.original._id,
        })}
        search={{ o: getOrigin() }}
        className="text-muted-foreground text-sm"
      >
        {getRelativeTime(row.original.completedAt)}
      </Link>
    ),
    enableSorting: false,
  },
];
