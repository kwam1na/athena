import { ColumnDef } from "@tanstack/react-table";

import { Badge } from "../../ui/badge";

import placeholder from "../../../assets/placeholder.png";
import { DataTableColumnHeader } from "./data-table-column-header";
import { DataTableRowActions } from "./data-table-row-actions";
import { capitalizeFirstLetter } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { Product } from "~/types";
import { Circle, CircleDashed, CircleDotDashed } from "lucide-react";

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
            to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/edit"
            params={(prev) => ({
              ...prev,
              orgUrlSlug: prev.orgUrlSlug!,
              storeUrlSlug: prev.storeUrlSlug!,
              productSlug: row.original._id,
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
      <Link
        to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/edit"
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
          productSlug: row.original._id,
        })}
        className="flex items-center gap-8"
      >
        <div className="flex items-center">
          {row.original.availability === "draft" && (
            <CircleDashed className="w-2.5 h-2.5 mr-2 text-muted-foreground" />
          )}

          {row.original.availability === "live" && (
            <Circle className="w-2.5 h-2.5 mr-2 text-muted-foreground" />
          )}
          <p className="text-sm">
            {capitalizeFirstLetter(row.original.availability)}
          </p>
        </div>
      </Link>
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
      <Link
        to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
          productSlug: row.original._id,
        })}
        className="flex items-center gap-8"
      >
        <div className="w-[80px]">{row.getValue("inventoryCount")}</div>
      </Link>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "quantityAvailable",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="# Available" />
    ),
    cell: ({ row }) => (
      <Link
        to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
          productSlug: row.original._id,
        })}
        className="flex items-center gap-8"
      >
        <div className="w-[80px]">{row.getValue("quantityAvailable")}</div>
      </Link>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    id: "actions",
    cell: ({ row }) => <DataTableRowActions row={row} />,
  },
];
