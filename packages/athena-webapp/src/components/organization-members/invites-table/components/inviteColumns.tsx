import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { InviteCode } from "~/types";
import { Check, Minus } from "lucide-react";

export const inviteColumns: ColumnDef<InviteCode>[] = [
  {
    accessorKey: "recipientEmail",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Email" />
    ),
    cell: ({ row }) => {
      return (
        <div className="flex space-x-2">
          <span className="font-medium">{row.getValue("recipientEmail")}</span>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "code",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Invite code" />
    ),
    cell: ({ row }) => {
      return <span className="font-medium">{row.getValue("code")}</span>;
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "redeemedAt",
    header: ({ column }) => <DataTableColumnHeader column={column} title="" />,
    cell: ({ row }) => {
      const redeemedAt = row.getValue("redeemedAt");
      return redeemedAt ? (
        <div className="flex items-center text-green-700">
          <Check className="w-4 h-4 mr-2" />
          Redeemed
        </div>
      ) : (
        <div className="flex items-center text-muted-foreground">
          <Minus className="w-4 h-4 mr-2" />
          Pending
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];
