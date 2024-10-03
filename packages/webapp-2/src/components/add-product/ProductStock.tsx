import { useState } from "react";
import View from "../View";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { PlusCircledIcon, TrashIcon } from "@radix-ui/react-icons";
import { getErrorForField } from "@/lib/utils";
import { Skeleton } from "../ui/skeleton";
import { CardFooter } from "../ui/card";
import { useProduct } from "@/contexts/ProductContext";
import { ImageFile } from "../ui/image-uploader";
import { RefreshCcw, RotateCcw } from "lucide-react";

export type ProductVariant = {
  id: number;
  sku?: string;
  stock?: number;
  cost?: number;
  price?: number;
  length?: number;
  color?: string;
  size?: string;
  markedForDeletion?: boolean;
  images: ImageFile[];
};

export function ProductStockView() {
  return (
    <View
      className="h-auto"
      header={<p className="text-sm text-muted-foreground">Variants</p>}
    >
      <Stock />
    </View>
  );
}

function Stock() {
  const {
    error,
    isLoading,
    removeProductVariant,
    productVariants,
    updateProductVariants,
    activeProductVariant,
    setActiveProductVariant,
  } = useProduct();

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    variantId: number,
    field: "sku" | "stock" | "cost" | "price"
  ) => {
    const value = field === "sku" ? e.target.value : parseFloat(e.target.value);
    updateProductVariants((prevVariants) =>
      prevVariants.map((variant) =>
        variant.id === variantId ? { ...variant, [field]: value } : variant
      )
    );
  };

  const addRow = () => {
    const newVariant: ProductVariant = {
      id: Date.now(),
      sku: undefined,
      stock: undefined,
      cost: undefined,
      price: undefined,
      images: [],
    };

    updateProductVariants((prevVariants) => [...prevVariants, newVariant]);
    setActiveProductVariant(newVariant);
  };

  const handleDeleteAction = (
    variantId: number,
    markedForDeletion?: boolean
  ) => {
    if (markedForDeletion) {
      updateProductVariants((prevVariants) =>
        prevVariants.map((variant) =>
          variant.id === variantId
            ? { ...variant, markedForDeletion: false }
            : variant
        )
      );
    } else {
      removeProductVariant(variantId);
    }
  };

  return (
    <>
      {productVariants.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Price</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {productVariants.map((variant, index) => (
              <TableRow
                key={variant.id}
                className={variant.markedForDeletion ? "opacity-50" : ""}
              >
                <TableCell>
                  <Label htmlFor={`sku-${index}`} className="sr-only">
                    SKU
                  </Label>
                  {isLoading ? (
                    <Skeleton className="h-[40px] w-full" />
                  ) : (
                    <Input
                      id={`sku-${index}`}
                      type="text"
                      placeholder="SKU"
                      onChange={(e) => handleChange(e, variant.id, "sku")}
                      value={variant.sku || ""}
                      disabled={variant.markedForDeletion}
                    />
                  )}
                  {error && getErrorForField(error, "sku") && (
                    <p className="text-red-500 text-sm font-medium">
                      {getErrorForField(error, "sku")?.message}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <Label htmlFor={`stock-${index}`} className="sr-only">
                    Stock
                  </Label>
                  {isLoading ? (
                    <Skeleton className="h-[40px] w-full" />
                  ) : (
                    <Input
                      id={`stock-${index}`}
                      type="number"
                      placeholder="1"
                      onChange={(e) => handleChange(e, variant.id, "stock")}
                      value={variant.stock || ""}
                      disabled={variant.markedForDeletion}
                    />
                  )}
                  {error && getErrorForField(error, "inventoryCount") && (
                    <p className="text-red-500 text-sm font-medium">
                      {getErrorForField(error, "inventoryCount")?.message}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <Label htmlFor={`cost-${index}`} className="sr-only">
                    Cost
                  </Label>
                  {isLoading ? (
                    <Skeleton className="h-[40px] w-full" />
                  ) : (
                    <Input
                      id={`cost-${index}`}
                      type="number"
                      placeholder="9.99"
                      onChange={(e) => handleChange(e, variant.id, "cost")}
                      value={variant.cost || ""}
                      disabled={variant.markedForDeletion}
                    />
                  )}
                  {error && getErrorForField(error, "unitCost") && (
                    <p className="text-red-500 text-sm font-medium">
                      {getErrorForField(error, "unitCost")?.message}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <Label htmlFor={`price-${index}`} className="sr-only">
                    Price
                  </Label>
                  {isLoading ? (
                    <Skeleton className="h-[40px] w-full" />
                  ) : (
                    <Input
                      id={`price-${index}`}
                      type="number"
                      placeholder="9.99"
                      onChange={(e) => handleChange(e, variant.id, "price")}
                      value={variant.price || ""}
                      disabled={variant.markedForDeletion}
                    />
                  )}
                  {error && getErrorForField(error, "price") && (
                    <p className="text-red-500 text-sm font-medium">
                      {getErrorForField(error, "price")?.message}
                    </p>
                  )}
                </TableCell>
                {index !== 0 && (
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        handleDeleteAction(
                          variant.id,
                          variant.markedForDeletion
                        )
                      }
                      // disabled={
                      //   variant.markedForDeletion &&
                      //   activeProductVariant.id !== variant.id
                      // }
                    >
                      {variant.markedForDeletion ? (
                        <RotateCcw className="w-4 h-4" />
                      ) : (
                        <TrashIcon className="h-4 w-4 text-red-500" />
                      )}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <CardFooter className="justify-center pt-4">
        <Button
          size="sm"
          variant="ghost"
          className="gap-1 text-muted-foreground"
          onClick={addRow}
        >
          <PlusCircledIcon className="h-3.5 w-3.5" />
          Add Variant
        </Button>
      </CardFooter>
    </>
  );
}
