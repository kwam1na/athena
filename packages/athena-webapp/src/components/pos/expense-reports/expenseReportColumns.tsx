import { ColumnDef } from "@tanstack/react-table";
import { Link } from "@tanstack/react-router";

import { DataTableColumnHeader } from "../../base/table/data-table-column-header";
import { getRelativeTime } from "~/src/lib/utils";
import { getOrigin } from "~/src/lib/navigationUtils";
import type { Id } from "~/convex/_generated/dataModel";

export type ExpenseReportRow = {
  _id: Id<"expenseTransaction">;
  transactionNumber: string;
  formattedTotal: string;
  cashierName: string | null;
  itemCount: number;
  completedAt: number;
  notes?: string | null;
};

export const expenseReportColumns: ColumnDef<ExpenseReportRow>[] = [
  {
    accessorKey: "transactionNumber",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Transaction" />
    ),
    cell: ({ row }) => {
      const count = row.original.itemCount;
      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/pos/expense-reports/$reportId"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            reportId: row.original._id,
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
      <DataTableColumnHeader column={column} title="Total Value" />
    ),
    cell: ({ row }) => (
      <Link
        to="/$orgUrlSlug/store/$storeUrlSlug/pos/expense-reports/$reportId"
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
          reportId: row.original._id,
        })}
        search={{ o: getOrigin() }}
        className="flex items-center gap-2"
      >
        <span>{row.original.formattedTotal}</span>
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
        to="/$orgUrlSlug/store/$storeUrlSlug/pos/expense-reports/$reportId"
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
          reportId: row.original._id,
        })}
        search={{ o: getOrigin() }}
        className="flex items-center gap-2"
      >
        <span>{row.original.cashierName ?? "N/A"}</span>
      </Link>
    ),
    enableSorting: false,
  },
  {
    accessorKey: "completedAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Completed" />
    ),
    cell: ({ row }) => (
      <Link
        to="/$orgUrlSlug/store/$storeUrlSlug/pos/expense-reports/$reportId"
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
          reportId: row.original._id,
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
