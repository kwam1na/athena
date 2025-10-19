import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { Link } from "@tanstack/react-router";
import { Product } from "~/types";
import { ProductStatus } from "../../product/ProductStatus";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../../ui/accordion";
import { getProductName } from "~/src/lib/productUtils";
import { Checkbox } from "../../ui/checkbox";
import { useSelectedProducts } from "./selectable-data-provider";
import { CheckedState } from "@radix-ui/react-checkbox";

export const selectableProductColumns: ColumnDef<Product>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Product" />
    ),
    cell: ({ row }) => {
      const sku = row.original.skus[0];

      const { selectedProductSkus, setSelectedProductSkus } =
        useSelectedProducts();

      const selectedCount = row.original.skus.filter((sku) =>
        selectedProductSkus.has(sku._id)
      ).length;

      const selectedAll = selectedCount === row.original.skus.length;
      const isIndeterminate =
        selectedCount > 0 && selectedCount < row.original.skus.length;

      const handleSelectAll = (value: CheckedState) => {
        const newSelectedValues = new Set(selectedProductSkus);

        if (value) {
          // Add all SKUs of this product
          row.original.skus.forEach((sku) => newSelectedValues.add(sku._id));
        } else {
          // Remove only this product's SKUs
          row.original.skus.forEach((sku) => newSelectedValues.delete(sku._id));
        }

        setSelectedProductSkus(newSelectedValues);
      };

      return (
        <Accordion type="multiple">
          <AccordionItem className="border-none" value="item-1">
            <AccordionTrigger hideChevron>
              <div className="flex items-center gap-4">
                <Checkbox
                  checked={selectedAll}
                  onCheckedChange={handleSelectAll}
                  aria-label="Select all SKUs of this product"
                  className={
                    isIndeterminate ? "data-[state=checked]:bg-primary" : ""
                  }
                  {...(isIndeterminate && { "data-state": "indeterminate" })}
                />
                <div className="flex items-center gap-8">
                  {sku?.images[0] ? (
                    <img
                      alt="Uploaded image"
                      className={`aspect-square w-24 h-24 rounded-md object-cover`}
                      src={sku?.images[0]}
                    />
                  ) : (
                    <div className="aspect-square w-24 h-24 bg-gray-100 rounded-md" />
                  )}
                  <div className="flex items-center gap-4">
                    <span className="max-w-[500px] truncate font-medium">
                      {row.getValue("name")}
                    </span>
                  </div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-8 pt-8 px-16">
              {row.original.skus.map((sku) => (
                <div key={sku._id} className="flex items-center gap-8">
                  <div className="flex items-center gap-8">
                    <Checkbox
                      checked={selectedProductSkus.has(sku._id)}
                      onCheckedChange={(isSelected) => {
                        const newSelectedValues = new Set(selectedProductSkus);
                        if (isSelected) {
                          newSelectedValues.add(sku._id);
                        } else {
                          newSelectedValues.delete(sku._id);
                        }

                        setSelectedProductSkus(newSelectedValues);
                      }}
                      aria-label="Select row"
                    />
                    {sku?.images[0] ? (
                      <img
                        alt="Uploaded image"
                        className={`aspect-square w-12 h-12 rounded-md object-cover`}
                        src={sku?.images[0]}
                      />
                    ) : (
                      <div className="aspect-square w-12 h-12 bg-gray-100 rounded-md" />
                    )}
                    <div className="flex flex-col gap-2">
                      <span className="max-w-[500px] truncate font-medium">
                        {getProductName(sku)}
                      </span>

                      <p className="text-xs">{sku.price}</p>
                    </div>
                  </div>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "categoryId",
    header: ({ column }) => <DataTableColumnHeader column={column} title="" />,
    cell: () => null,
    enableSorting: false,
    enableHiding: true,
  },
  {
    accessorKey: "subcategoryId",
    header: ({ column }) => <DataTableColumnHeader column={column} title="" />,
    cell: () => null,
    enableSorting: false,
    enableHiding: true,
  },
  // {
  //   accessorKey: "inventoryCount",
  //   header: ({ column }) => (
  //     <DataTableColumnHeader column={column} title="Inventory" />
  //   ),
  //   cell: ({ row }) => {
  //     return (
  //       <div className="flex items-center gap-8">
  //         <div className="flex items-center gap-2">
  //           <div className="flex items-center gap-1">
  //             <strong>{row.original.skus.length}</strong>
  //             <p className="text-muted-foreground">
  //               {row.original.skus.length == 1 ? "variant" : "variants"}
  //             </p>
  //           </div>
  //           <p>/</p>
  //           <div className="flex items-center gap-1">
  //             <strong>{row.getValue("inventoryCount")}</strong>
  //             <p className="text-muted-foreground">stock</p>
  //           </div>
  //           <p>/</p>
  //           <div className="flex items-center gap-1">
  //             <strong>{row.original.quantityAvailable}</strong>
  //             <p className="text-muted-foreground">available</p>
  //           </div>
  //         </div>
  //       </div>
  //     );
  //   },
  //   enableSorting: false,
  //   enableHiding: false,
  // },
];
