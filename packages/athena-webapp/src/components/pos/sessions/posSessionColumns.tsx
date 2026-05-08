import type { ColumnDef } from "@tanstack/react-table";

import { DataTableColumnHeader } from "@/components/base/table/data-table-column-header";
import { WorkflowTraceRouteLink } from "@/components/traces/WorkflowTraceRouteLink";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type POSSessionOperationsRow = {
  _id: string;
  cartCount: number;
  cartCountLabel: string;
  customerLabel: string;
  expiresAt: number;
  expiryLabel: string;
  expiryTone: string;
  holdDetailLabel: string;
  holdLabel: string;
  holdQuantity: number;
  operatorLabel: string;
  registerLabel: string;
  sessionCode: string;
  status: string;
  statusBadgeClass: string;
  statusLabel: string;
  total: number;
  totalLabel: string;
  workflowTraceId: string | null;
};

export const posSessionColumns: ColumnDef<POSSessionOperationsRow>[] = [
    {
      accessorKey: "sessionCode",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Session" />
      ),
      cell: ({ row }) => (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">
              {row.original.sessionCode}
            </span>
            <Badge
              className={row.original.statusBadgeClass}
              size="sm"
              variant="outline"
            >
              {row.original.statusLabel}
            </Badge>
          </div>
          {row.original.workflowTraceId ? (
            <WorkflowTraceRouteLink
              className="text-xs text-muted-foreground hover:text-primary"
              traceId={row.original.workflowTraceId}
            >
              Workflow trace
            </WorkflowTraceRouteLink>
          ) : (
            <span className="block text-xs text-muted-foreground">
              No workflow trace
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "operatorLabel",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Operator" />
      ),
      cell: ({ row }) => (
        <div className="space-y-1 text-sm">
          <span className="block font-medium text-foreground">
            {row.original.operatorLabel}
          </span>
          <span className="block text-xs text-muted-foreground">
            {row.original.registerLabel}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "customerLabel",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Customer" />
      ),
      cell: ({ row }) => (
        <span className="text-sm text-foreground">
          {row.original.customerLabel}
        </span>
      ),
    },
    {
      accessorKey: "cartCount",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Cart" />
      ),
      cell: ({ row }) => (
        <div className="space-y-1 text-sm">
          <span className="block font-medium text-foreground">
            {row.original.cartCountLabel}
          </span>
          <span className="block font-numeric text-xs tabular-nums text-muted-foreground">
            {row.original.totalLabel}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "holdQuantity",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Active holds" />
      ),
      cell: ({ row }) => (
        <div className="space-y-1 text-sm">
          <span className="block font-medium text-foreground">
            {row.original.holdLabel}
          </span>
          <span className="block max-w-56 truncate text-xs text-muted-foreground">
            {row.original.holdDetailLabel}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "expiresAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Expiry" />
      ),
      cell: ({ row }) => (
        <span
          className={cn(
            "block min-w-36 text-sm tabular-nums",
            row.original.expiryTone,
          )}
        >
          {row.original.expiryLabel}
        </span>
      ),
    },
  ];
