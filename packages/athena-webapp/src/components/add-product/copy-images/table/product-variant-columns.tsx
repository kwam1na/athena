import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { ProductVariant } from "../../ProductStock";
import { Checkbox } from "~/src/components/ui/checkbox";
import { useCopyImages } from "../CopyImagesProvider";
import { capitalizeFirstLetter } from "~/src/lib/utils";

export const productVariantColumns: ColumnDef<
  ProductVariant & { type: "source" | "destination" }
>[] = [
  {
    accessorKey: "code",
    header: ({ column, table }) => (
      <DataTableColumnHeader
        column={column}
        title={capitalizeFirstLetter(table.getRowModel().rows[0].original.type)}
      />
    ),
    cell: ({ row }) => {
      const variant = row.original;
      const type = variant.type;

      const { source, destination, setSourceVariant, setDestinationVariant } =
        useCopyImages();

      const destinationRowIsSelectedSourceVariant =
        type === "destination" && !destination && source?.sku === variant.sku;

      const sourceRowIsSelectedDestinationVariant =
        type === "source" && !source && destination?.sku === variant.sku;

      const shouldDisable =
        (type == "source" && source && source.sku !== variant.sku) ||
        (type == "destination" &&
          destination &&
          destination.sku !== variant.sku);

      return (
        <div
          className={`flex items-center gap-4 transition-opacity duration-200 ease-in-out ${destinationRowIsSelectedSourceVariant || sourceRowIsSelectedDestinationVariant || shouldDisable ? "opacity-50" : ""}`}
        >
          <div className="flex items-center gap-4">
            <Checkbox
              onCheckedChange={(checked) => {
                if (checked) {
                  if (type === "source") {
                    setSourceVariant(variant);
                  } else {
                    setDestinationVariant(variant);
                  }
                } else {
                  if (type === "source") {
                    setSourceVariant(null);
                  } else {
                    setDestinationVariant(null);
                  }
                }
              }}
              disabled={Boolean(
                shouldDisable || destinationRowIsSelectedSourceVariant
              )}
              checked={
                (source?.sku === variant.sku && type === "source") ||
                (destination?.sku === variant.sku && type === "destination")
              }
            />
            <div className="flex items-center gap-2">
              {variant.images.length > 0 && (
                <img
                  src={variant.images[0].preview}
                  alt={variant.sku}
                  className="w-12 h-12 object-cover rounded"
                />
              )}
            </div>
          </div>
          <p className="text-sm">{variant.sku}</p>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];
