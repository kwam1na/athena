import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "@tanstack/react-router";

import { DataTableColumnHeader } from "../base/table/data-table-column-header";
import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";
import { getOrigin } from "@/lib/navigationUtils";

export type RegisterSessionRow = {
  _id: string;
  accountabilityLabel: string;
  closedAtLabel: string;
  countedCashLabel: string;
  depositedLabel: string;
  expectedCashLabel: string;
  expectedCashValue: number;
  openedAtLabel: string;
  openedAtSort: number;
  openedByLabel: string;
  registerLabel: string;
  sessionCode: string;
  status: string;
  statusLabel: string;
  timelineDateLabel: string;
  timelineDurationLabel: string;
  timelineRangeLabel: string;
  varianceCaption: string;
  varianceLabel: string;
  varianceTone: string;
  varianceValue: number;
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
      <DataTableColumnHeader column={column} title="Session" />
    ),
    cell: ({ row }) => (
      <RegisterSessionLink
        className="space-y-1.5 text-foreground hover:text-primary"
        row={row.original}
      >
        <span className="block font-medium">{row.original.registerLabel}</span>
        <span className="inline-flex rounded-md border border-border/70 bg-muted/30 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          {row.original.sessionCode}
        </span>
      </RegisterSessionLink>
    ),
  },
  {
    accessorKey: "openedByLabel",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Operator" />
    ),
    cell: ({ row }) => (
      <RegisterSessionLink
        className="space-y-1.5 text-sm"
        row={row.original}
      >
        <span className="block font-medium text-foreground">
          {row.original.openedByLabel}
        </span>
        <span className="block text-xs text-muted-foreground">
          {row.original.accountabilityLabel}
        </span>
      </RegisterSessionLink>
    ),
  },
  {
    accessorKey: "openedAtSort",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Timeline" />
    ),
    cell: ({ row }) => (
      <RegisterSessionLink
        className="space-y-1.5 text-sm"
        row={row.original}
      >
        <span className="flex items-center gap-2">
          <span className="font-medium text-foreground">
            {row.original.timelineDateLabel}
          </span>
          <Badge
            className={getStatusBadgeClass(row.original.status)}
            size="sm"
            variant="outline"
          >
            {row.original.statusLabel}
          </Badge>
        </span>
        <span className="flex items-center gap-2 text-muted-foreground">
          <span>{row.original.timelineRangeLabel}</span>
          <span aria-hidden className="h-1 w-1 rounded-full bg-border" />
          <span>{row.original.timelineDurationLabel}</span>
        </span>
        {row.original.status === "closing" ? (
          <span className="block text-xs text-warning">
            Closeout in progress
          </span>
        ) : null}
      </RegisterSessionLink>
    ),
  },
  {
    accessorKey: "expectedCashValue",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Cash position" />
    ),
    cell: ({ row }) => (
      <RegisterSessionLink
        className="min-w-56 space-y-2 text-sm"
        row={row.original}
      >
        <span className="grid grid-cols-3 gap-3">
          <span>
            <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Expected
            </span>
            <span className="mt-1 block font-mono text-foreground">
              {row.original.expectedCashLabel}
            </span>
          </span>
          <span>
            <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Counted
            </span>
            <span className="mt-1 block font-mono text-foreground">
              {row.original.countedCashLabel}
            </span>
          </span>
          <span>
            <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Deposited
            </span>
            <span className="mt-1 block font-mono text-foreground">
              {row.original.depositedLabel}
            </span>
          </span>
        </span>
      </RegisterSessionLink>
    ),
  },
  {
    accessorKey: "varianceValue",
    header: ({ column }) => (
      <DataTableColumnHeader
        className="justify-end"
        column={column}
        title="Discrepancy"
      />
    ),
    cell: ({ row }) => (
      <RegisterSessionLink
        className="space-y-1 text-right"
        row={row.original}
      >
        <span
          className={cn("block font-mono text-sm", row.original.varianceTone)}
        >
          {row.original.varianceLabel}
        </span>
        <span className="block text-xs text-muted-foreground">
          {row.original.varianceCaption}
        </span>
      </RegisterSessionLink>
    ),
  },
];
