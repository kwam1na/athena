import { ColumnDef } from "@tanstack/react-table";
import { Link } from "@tanstack/react-router";
import { ProductSku } from "~/types";
import { capitalizeWords } from "~/src/lib/utils";
import { getOrigin } from "~/src/lib/navigationUtils";
import { DataTableColumnHeader } from "../../base/table/data-table-column-header";
import { getProductName } from "~/src/lib/productUtils";

export const complimentaryProductsColumns: ColumnDef<ProductSku>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Product" />
    ),
    cell: ({ row }) => {
      const sku = row.original;

      return (
        <div className="flex space-x-2">
          <Link
            to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
            params={(prev) => ({
              ...prev,
              orgUrlSlug: prev.orgUrlSlug!,
              storeUrlSlug: prev.storeUrlSlug!,
              productSlug: row.original.productId,
            })}
            search={{ o: getOrigin(), variant: sku.sku }}
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
                {getProductName(sku)}
              </span>
            </div>
          </Link>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];
