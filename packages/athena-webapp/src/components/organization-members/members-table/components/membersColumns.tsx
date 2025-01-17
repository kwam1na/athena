import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { AthenaUser } from "~/types";

export const membersColumns: ColumnDef<AthenaUser>[] = [
  {
    accessorKey: "email",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Email" />
    ),
    cell: ({ row }) => {
      return (
        <div className="flex space-x-2">
          <span className="font-medium">{row.getValue("email")}</span>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];
