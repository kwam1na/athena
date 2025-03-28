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
import { Info, RotateCcw, TriangleAlert } from "lucide-react";
import useGetActiveProduct from "@/hooks/useGetActiveProduct";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { set } from "zod";

export type ProductVariant = {
  id: string;
  sku?: string;
  stock?: number;
  quantityAvailable?: number;
  cost?: number;
  price?: number;
  netPrice?: number;
  length?: number;
  color?: string;
  size?: string;
  weight?: string;
  markedForDeletion?: boolean;
  existsInDB?: boolean;
  images: ImageFile[];
};

const StockHeader = () => {
  const { updateProductVariants } = useProduct();

  const restock = () => {
    updateProductVariants((prevVariants) =>
      prevVariants.map((variant) => ({
        ...variant,
        stock: 5,
        quantityAvailable: 5,
      }))
    );
  };

  return (
    <div className="flex items-center justify-between">
      <p className="text-sm">Variants</p>
      <Button onClick={restock} variant={"ghost"} size={"sm"}>
        Restock all
      </Button>
    </div>
  );
};

export function ProductStockView() {
  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto"
      header={<StockHeader />}
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

  const { activeProduct } = useGetActiveProduct();

  const { activeStore } = useGetActiveStore();

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    variantId: string,
    field: "sku" | "stock" | "cost" | "netPrice" | "quantityAvailable"
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
      id: Date.now().toString(),
      sku: undefined,
      stock: undefined,
      quantityAvailable: undefined,
      cost: undefined,
      price: undefined,
      images: [],
    };

    updateProductVariants((prevVariants) => [...prevVariants, newVariant]);
    setActiveProductVariant(newVariant);
  };

  const handleDeleteAction = (
    variantId: string,
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

  const setOutOfStock = (id: string) => {
    updateProductVariants((prevVariants) =>
      prevVariants.map((variant) =>
        variant.id === id
          ? { ...variant, quantityAvailable: 0, stock: 0 }
          : variant
      )
    );
  };

  const isLastActiveVariant = (index: number) => {
    return productVariants.every(
      (v, idx) => index == idx || v.markedForDeletion
    );
  };

  return (
    <>
      {productVariants.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <div className="flex items-center gap-1">
                  <p>SKU</p>
                  {!activeProduct && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <Info className="w-3.5 h-3.5 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>auto-generated if left blank</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </TableHead>
              <TableHead>Stock</TableHead>
              <TableHead># Available</TableHead>
              <TableHead>{`Price (${activeStore?.currency.toUpperCase()})`}</TableHead>
              <TableHead>{`Cost (${activeStore?.currency.toUpperCase()})`}</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {productVariants.map((variant, index) => (
              <TableRow
                key={variant.id}
                onClick={() => setActiveProductVariant(variant)}
                className={variant.markedForDeletion ? "opacity-50" : ""}
              >
                <TableCell>
                  {isLoading ? (
                    <Skeleton className="h-[40px] w-full" />
                  ) : !activeProduct ? (
                    <Input
                      id={`sku-${index}`}
                      type="text"
                      placeholder="SKU"
                      onChange={(e) => handleChange(e, variant.id, "sku")}
                      value={variant.sku || ""}
                      disabled={variant.markedForDeletion}
                    />
                  ) : (
                    <p
                      className={`${variant.id == activeProductVariant.id ? "font-bold" : "text-muted-foreground"}`}
                    >
                      {variant.sku}
                    </p>
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
                  <Label htmlFor={`stock-${index}`} className="sr-only">
                    # Available
                  </Label>
                  {isLoading ? (
                    <Skeleton className="h-[40px] w-full" />
                  ) : (
                    <Input
                      id={`quantity-available-${index}`}
                      type="number"
                      placeholder="1"
                      onChange={(e) =>
                        handleChange(e, variant.id, "quantityAvailable")
                      }
                      value={variant.quantityAvailable || ""}
                      disabled={variant.markedForDeletion}
                    />
                  )}
                  {error && getErrorForField(error, "quantityAvailable") && (
                    <p className="text-red-500 text-sm font-medium">
                      {getErrorForField(error, "quantityAvailable")?.message}
                    </p>
                  )}
                </TableCell>

                <TableCell>
                  <Label htmlFor={`price-${index}`} className="sr-only">
                    {`Price ${activeStore?.currency}`}
                  </Label>
                  {isLoading ? (
                    <Skeleton className="h-[40px] w-full" />
                  ) : (
                    <Input
                      id={`price-${index}`}
                      type="number"
                      placeholder="999"
                      onChange={(e) => handleChange(e, variant.id, "netPrice")}
                      value={variant.netPrice || ""}
                      disabled={variant.markedForDeletion}
                    />
                  )}
                  {error && getErrorForField(error, "price") && (
                    <p className="text-red-500 text-sm font-medium">
                      {getErrorForField(error, "price")?.message}
                    </p>
                  )}
                </TableCell>

                <TableCell>
                  <Label htmlFor={`cost-${index}`} className="sr-only">
                    Cost
                  </Label>
                  <Input
                    id={`cost-${index}`}
                    type="number"
                    placeholder="999"
                    onChange={(e) => handleChange(e, variant.id, "cost")}
                    value={variant.cost || ""}
                    disabled={variant.markedForDeletion}
                  />
                  {error && getErrorForField(error, "unitCost") && (
                    <p className="text-red-500 text-sm font-medium">
                      {getErrorForField(error, "unitCost")?.message}
                    </p>
                  )}
                </TableCell>

                <TableCell>
                  <div className="flex items-center gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setOutOfStock(variant.id)}
                            disabled={
                              (variant.quantityAvailable == 0 &&
                                variant.stock == 0) ||
                              variant.markedForDeletion
                            }
                          >
                            <TriangleAlert className="w-4 h-4 text-yellow-500" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Set to out of stock</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    {productVariants.length > 1 && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                handleDeleteAction(
                                  variant.id,
                                  variant.markedForDeletion
                                )
                              }
                              disabled={isLastActiveVariant(index)}
                            >
                              {variant.markedForDeletion ? (
                                <RotateCcw className="w-4 h-4" />
                              ) : (
                                <TrashIcon className="h-4 w-4 text-red-500" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          {!variant.markedForDeletion && (
                            <TooltipContent>
                              <p>Delete</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                </TableCell>
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
