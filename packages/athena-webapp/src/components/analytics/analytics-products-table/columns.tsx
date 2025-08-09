import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { capitalizeWords } from "~/convex/utils";
import { AnalyticProduct } from "../AnalyticsProducts";
import { Clock, Eye } from "lucide-react";
import { getRelativeTime } from "~/src/lib/utils";
import { Link } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";

export const columns: ColumnDef<AnalyticProduct>[] = [
  {
    accessorKey: "action",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Recently viewed" />
    ),
    cell: ({ row }) => {
      const item = row.original;
      const product = item.product;
      const sku = product?.skus.find((s) => s.sku === item.productSku);

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
          params={(p) => ({
            ...p,
            orgUrlSlug: p.orgUrlSlug!,
            storeUrlSlug: p.storeUrlSlug!,
            productSlug: product.slug,
          })}
          search={{
            o: getOrigin(),
            variant: sku?.sku,
          }}
          className="flex items-center gap-8"
        >
          {sku?.images[0] ? (
            <img
              alt="Uploaded image"
              className={`aspect-square w-16 h-16 rounded-md object-cover`}
              src={sku.images[0]}
            />
          ) : (
            <div className="aspect-square w-16 h-16 bg-gray-100 rounded-md" />
          )}
          <div className="flex flex-col gap-1">
            <span className="max-w-[240px] truncate font-medium">
              {capitalizeWords(product?.name || "")}
            </span>
          </div>
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "views",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Views" />
    ),
    cell: ({ row }) => {
      const item = row.original;

      return (
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4" />
          <p>{item.views}</p>
        </div>
      );
    },
  },
  {
    accessorKey: "lastViewed",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Last viewed" />
    ),
    cell: ({ row }) => {
      const item = row.original;

      return (
        <p className="text-muted-foreground">
          {getRelativeTime(item.lastViewed)}
        </p>
      );
    },
  },
];
