import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "@tanstack/react-router";

import { DataTableColumnHeader } from "../base/table/data-table-column-header";
import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";
import { getOrigin } from "@/lib/navigationUtils";

export type RegisterSessionRow = {
  _id: string;
  closedAtLabel: string;
  countedCashLabel: string;
  depositedLabel: string;
  expectedCashLabel: string;
  openedAtLabel: string;
  openedByLabel: string;
  registerLabel: string;
  sessionCode: string;
  status: string;
  statusLabel: string;
  varianceLabel: string;
  varianceTone: string;
};

function RegisterSessionLink({
  children,
  row,
  className,
}: {
  children: React.ReactNode;
  className?: string;
  row: RegisterSessionRow;
}) {
  return (
    <Link
      className={cn(
        "block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      params={(prev) => ({
        ...prev,
        orgUrlSlug: prev.orgUrlSlug!,
        sessionId: row._id,
        storeUrlSlug: prev.storeUrlSlug!,
      })}
      search={{ o: getOrigin() }}
      to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
    >
      {children}
    </Link>
  );
}

function getStatusBadgeClass(status: string) {
  switch (status) {
    case "active":
    case "open":
      return "border-transparent bg-success/10 text-success";
    case "closing":
      return "border-transparent bg-warning/15 text-warning";
    case "closed":
      return "border-transparent bg-muted text-muted-foreground";
    default:
      return "border-transparent bg-muted text-muted-foreground";
  }
}

export const registerSessionColumns: ColumnDef<RegisterSessionRow>[] = [
  {
    accessorKey: "registerLabel",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Register" />
    ),
    cell: ({ row }) => (
      <RegisterSessionLink
        className="space-y-1 text-foreground hover:text-primary"
        row={row.original}
      >
        <span className="block font-medium">{row.original.registerLabel}</span>
        <span className="block font-mono text-xs text-muted-foreground">
          {row.original.sessionCode}
        </span>
      </RegisterSessionLink>
    ),
  },
  {
    accessorKey: "statusLabel",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => (
      <RegisterSessionLink row={row.original}>
        <Badge
          className={getStatusBadgeClass(row.original.status)}
          size="sm"
          variant="outline"
        >
          {row.original.statusLabel}
        </Badge>
      </RegisterSessionLink>
    ),
  },
  {
    accessorKey: "openedAtLabel",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Opened" />
    ),
    cell: ({ row }) => (
      <RegisterSessionLink
        className="text-sm text-muted-foreground"
        row={row.original}
      >
        {row.original.openedAtLabel}
      </RegisterSessionLink>
    ),
  },
  {
    accessorKey: "closedAtLabel",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Closed" />
    ),
    cell: ({ row }) => (
      <RegisterSessionLink
        className="text-sm text-muted-foreground"
        row={row.original}
      >
        {row.original.closedAtLabel}
      </RegisterSessionLink>
    ),
  },
  {
    accessorKey: "openedByLabel",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Opened by" />
    ),
    cell: ({ row }) => (
      <RegisterSessionLink
        className="text-sm text-muted-foreground"
        row={row.original}
      >
        {row.original.openedByLabel}
      </RegisterSessionLink>
    ),
  },
  {
    accessorKey: "expectedCashLabel",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Expected" />
    ),
    cell: ({ row }) => (
      <RegisterSessionLink
        className="font-mono text-foreground"
        row={row.original}
      >
        {row.original.expectedCashLabel}
      </RegisterSessionLink>
    ),
  },
  {
    accessorKey: "countedCashLabel",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Counted" />
    ),
    cell: ({ row }) => (
      <RegisterSessionLink
        className="font-mono text-foreground"
        row={row.original}
      >
        {row.original.countedCashLabel}
      </RegisterSessionLink>
    ),
  },
  {
    accessorKey: "depositedLabel",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Deposited" />
    ),
    cell: ({ row }) => (
      <RegisterSessionLink
        className="font-mono text-foreground"
        row={row.original}
      >
        {row.original.depositedLabel}
      </RegisterSessionLink>
    ),
  },
  {
    accessorKey: "varianceLabel",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Variance" />
    ),
    cell: ({ row }) => (
      <RegisterSessionLink
        className={cn("font-mono", row.original.varianceTone)}
        row={row.original}
      >
        {row.original.varianceLabel}
      </RegisterSessionLink>
    ),
  },
];
