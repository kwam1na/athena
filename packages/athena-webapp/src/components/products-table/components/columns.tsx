import { ColumnDef } from "@tanstack/react-table";

import { Badge } from "../../ui/badge";

import placeholder from "@/assets/placeholder.png";
import { DataTableColumnHeader } from "./data-table-column-header";
import { DataTableRowActions } from "./data-table-row-actions";
import { capitalizeFirstLetter } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { Product } from "~/types";

export const columns: ColumnDef<Product>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Product" />
    ),
    cell: ({ row }) => {
      const sku = row.original.skus[0];

      return (
        <div className="flex space-x-2">
          <Link
            to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
            params={(prev) => ({
              ...prev,
              orgUrlSlug: prev.orgUrlSlug!,
              storeUrlSlug: prev.storeUrlSlug!,
              productSlug: row.original.slug,
            })}
            className="flex items-center gap-8"
          >
            <img
              alt="Uploaded image"
              className={`aspect-square w-12 h-12 rounded-md object-cover`}
              src={sku?.images[0] || placeholder}
            />
            <span className="max-w-[500px] truncate font-medium">
              {row.getValue("name")}
            </span>
          </Link>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "availability",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => (
      <Badge variant="outline">
        {capitalizeFirstLetter(row.original.availability)}
      </Badge>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "inventoryCount",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Stock" />
    ),
    cell: ({ row }) => (
      <div className="w-[80px]">{row.getValue("inventoryCount")}</div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    id: "actions",
    cell: ({ row }) => <DataTableRowActions row={row} />,
  },
];
