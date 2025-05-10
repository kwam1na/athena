import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { Link } from "@tanstack/react-router";
import { Product } from "~/types";
import { ProductStatus } from "../../../product/ProductStatus";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Badge } from "~/src/components/ui/badge";
import { capitalizeWords } from "~/src/lib/utils";
import { getOrigin } from "~/src/lib/navigationUtils";
import { AlertOctagon } from "lucide-react";

export const productColumns: ColumnDef<Product>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Product" />
    ),
    cell: ({ row }) => {
      const sku = row.original.skus[0];

      const hasNoImages = row.original.skus.some(
        (sku) => sku.images.length === 0
      );

      return (
        <div className="flex space-x-2">
          <Link
            to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
            params={(prev) => ({
              ...prev,
              orgUrlSlug: prev.orgUrlSlug!,
              storeUrlSlug: prev.storeUrlSlug!,
              productSlug: row.original._id,
            })}
            search={{ o: getOrigin() }}
            className="flex items-center gap-8"
          >
            {sku?.images[0] ? (
              <img
                alt="Uploaded image"
                className={`aspect-square w-16 h-16 rounded-md object-cover`}
                src={sku?.images[0]}
              />
            ) : (
              <div className="aspect-square w-12 h-12 bg-gray-100 rounded-md" />
            )}
            <div className="flex items-center gap-4">
              <span className="max-w-[500px] truncate font-medium">
                {capitalizeWords(row.getValue("name"))}
              </span>
              <ProductStatus product={row.original} />
              {hasNoImages && (
                <Badge
                  variant="outline"
                  className="flex items-center gap-2 bg-blue-100 text-blue-700"
                >
                  <AlertOctagon className="w-3.5 h-3.5" />
                  <p className="text-xs">Missing product images</p>
                </Badge>
              )}
            </div>
          </Link>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "categoryId",
    header: ({ column }) => <DataTableColumnHeader column={column} title="" />,
    cell: ({ row }) => {
      const category = useQuery(api.inventory.categories.getById, {
        id: row.original.categoryId,
        storeId: row.original.storeId,
      });

      return (
        <div className="flex space-x-2">
          <Link
            to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
            params={(prev) => ({
              ...prev,
              orgUrlSlug: prev.orgUrlSlug!,
              storeUrlSlug: prev.storeUrlSlug!,
              productSlug: row.original._id,
            })}
            search={{ o: getOrigin() }}
            className="flex items-center gap-8"
          >
            <div className="flex items-center gap-4">
              <Badge variant="outline" className="bg-gray-100 text-gray-700">
                <p className="text-xs">{category?.name}</p>
              </Badge>
            </div>
          </Link>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: true,
  },
  {
    accessorKey: "subcategoryId",
    header: ({ column }) => <DataTableColumnHeader column={column} title="" />,
    cell: ({ row }) => {
      const subcategory = useQuery(api.inventory.subcategories.getById, {
        id: row.original.subcategoryId,
        storeId: row.original.storeId,
      });

      return (
        <div className="flex space-x-2">
          <Link
            to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
            params={(prev) => ({
              ...prev,
              orgUrlSlug: prev.orgUrlSlug!,
              storeUrlSlug: prev.storeUrlSlug!,
              productSlug: row.original._id,
            })}
            search={{ o: getOrigin() }}
            className="flex items-center gap-8"
          >
            <div className="flex items-center gap-4">
              <Badge variant="outline" className="bg-gray-100 text-gray-700">
                <p className="text-xs">{subcategory?.name}</p>
              </Badge>
            </div>
          </Link>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: true,
  },
  {
    accessorKey: "inventoryCount",
    header: ({ column }) => <DataTableColumnHeader column={column} title="" />,
    cell: ({ row }) => {
      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            productSlug: row.original._id,
          })}
          search={{ o: getOrigin() }}
          className="flex items-center gap-8"
        >
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <strong>{row.original.skus.length}</strong>
              <p className="text-muted-foreground">
                {row.original.skus.length == 1 ? "variant" : "variants"}
              </p>
            </div>
            <p>/</p>
            <div className="flex items-center gap-1">
              <strong>{row.getValue("inventoryCount")}</strong>
              <p className="text-muted-foreground">stock</p>
            </div>
            <p>/</p>
            <div className="flex items-center gap-1">
              <strong>{row.original.quantityAvailable}</strong>
              <p className="text-muted-foreground">available</p>
            </div>
          </div>
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];
