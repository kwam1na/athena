import React from "react";
import { useProduct } from "@/contexts/ProductContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { ProductVariant } from "./ProductStock";

interface AttributesTableProps {
  selectedAttributes: string[];
}

function AttributesTable({ selectedAttributes }: AttributesTableProps) {
  const { isLoading, productVariants, updateProductVariant } = useProduct();

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    variantId: number,
    attribute: string
  ) => {
    updateProductVariant(variantId, { [attribute]: e.target.value });
  };

  const getProductAttribute = (attribute: string, variant: ProductVariant) => {
    switch (attribute) {
      case "length":
        return variant.length;

      case "color":
        return variant.color;

      case "size":
        return variant.size;

      default:
        return "";
    }
  };

  return (
    <Table className="px-4">
      <TableHeader>
        <TableRow>
          <TableHead>Variant</TableHead>
          {selectedAttributes.map((attr) => (
            <TableHead key={attr}>
              {attr.charAt(0).toUpperCase() + attr.slice(1)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {productVariants.map((variant, index) => (
          <TableRow
            key={variant.id}
            className={variant.markedForDeletion ? "opacity-50" : ""}
          >
            <TableCell>{index + 1}</TableCell>
            {selectedAttributes.map((attr) => (
              <TableCell key={`${variant.id}-${attr}`}>
                {isLoading ? (
                  <Skeleton className="h-[40px] w-full" />
                ) : (
                  <Input
                    id={`${variant.id}-${attr}`}
                    type={attr === "length" ? "number" : "text"}
                    placeholder={attr === "length" ? "Length (inches)" : attr}
                    onChange={(e) => handleChange(e, variant.id, attr)}
                    value={getProductAttribute(attr, variant) || ""}
                    disabled={variant.markedForDeletion}
                  />
                )}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default AttributesTable;
