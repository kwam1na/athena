import React, { useState } from "react";
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
import { Button } from "../ui/button";
import { Ban, CheckCircle2, Plus } from "lucide-react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

interface AttributesTableProps {
  selectedAttributes: string[];
}

function AttributesTable({ selectedAttributes }: AttributesTableProps) {
  const {
    isLoading,
    productVariants,
    updateProductVariant,
    activeProductVariant,
    setActiveProductVariant,
  } = useProduct();

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    variantId: string,
    attribute: string
  ) => {
    updateProductVariant(variantId, { [attribute]: e.target.value });
  };

  const { activeStore } = useGetActiveStore();

  const colorsData = useQuery(
    api.inventory.colors.getAll,
    activeStore ? { storeId: activeStore._id } : "skip"
  );

  const colors =
    colorsData
      ?.map((color: any) => ({
        name: color.name,
        id: color._id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)) || [];

  const getProductAttribute = (attribute: string, variant: ProductVariant) => {
    switch (attribute) {
      case "length":
        return variant.length;

      case "color":
        return variant.color;

      case "size":
        return variant.size;

      case "weight":
        return variant.weight;

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
              <div className="flex justify-between items-center">
                {`${attr.charAt(0).toUpperCase() + attr.slice(1)} ${attr == "length" ? "(inches)" : ""}`}
                {attr == "color" && <ColorPopover />}
              </div>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {productVariants?.map((variant, index) => (
          <TableRow
            key={variant.id}
            className={variant.markedForDeletion ? "opacity-50" : ""}
            onClick={() => setActiveProductVariant(variant)}
          >
            <TableCell>
              <p
                className={`${variant.id == activeProductVariant.id ? "font-bold" : "text-muted-foreground"}`}
              >
                {index + 1}
              </p>
            </TableCell>
            {selectedAttributes.map((attr) => (
              <TableCell key={`${variant.id}-${attr}`}>
                {isLoading ? (
                  <Skeleton className="h-[40px] w-full" />
                ) : attr == "color" ? (
                  <Select
                    onValueChange={(value: string) => {
                      updateProductVariant(variant.id, { color: value });
                    }}
                    value={variant.color}
                  >
                    <SelectTrigger
                      id="color"
                      aria-label="Select color"
                      disabled={variant.markedForDeletion}
                    >
                      <SelectValue placeholder="Select color" />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectGroup>
                        {colors.map((color: any) => {
                          return (
                            <SelectItem key={color.id} value={color.id}>
                              {capitalizeWords(color.name)}
                            </SelectItem>
                          );
                        })}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={`${variant.id}-${attr}`}
                    type={attr === "length" ? "number" : "text"}
                    placeholder={attr}
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

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { LoadingButton } from "../ui/loading-button";
import { toast } from "sonner";
import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { capitalizeWords } from "~/src/lib/utils";

export function ColorPopover() {
  const [isUpdateMutationPending, setIsUpdateMutationPending] = useState(false);
  const [open, setOpen] = useState(false);

  const { activeStore } = useGetActiveStore();

  const FormSchema = z.object({
    name: z.string().min(1, {
      message: "Please provide a valid name.",
    }),
  });

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
    },
  });

  const createColor = useMutation(api.inventory.colors.create);

  async function onSubmit() {
    if (!activeStore) return;

    try {
      setIsUpdateMutationPending(true);

      const color = await createColor({
        name: form.getValues().name,
        storeId: activeStore?._id,
      });

      toast(`Color '${color?.name}' created`, {
        icon: <CheckCircle2 className="h-4 w-4" />,
      });
    } catch (e) {
      toast("Something went wrong", {
        icon: <Ban className="h-4 w-4" />,
        description: (e as Error).message,
      });
    } finally {
      setIsUpdateMutationPending(false);
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={(o) => setOpen(o)}>
      <PopoverTrigger asChild>
        <Button variant={"ghost"} className="text-muted-foreground text-xs">
          <Plus className="mr-2 h-3 w-3" />
          New
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="w-full space-y-4"
          >
            <p className="font-medium">Add new color</p>
            <div className="flex flex-col w-full">
              <div className="flex gap-4">
                <div>
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-muted-foreground">
                          Color
                        </FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div
                  className={`h-full flex self-end transition-opacity duration-300 ${form.formState.isDirty ? "opacity-100" : "opacity-0 pointer-events-none"}`}
                >
                  <LoadingButton
                    isLoading={isUpdateMutationPending}
                    type="submit"
                  >
                    Add
                  </LoadingButton>
                </div>
              </div>
            </div>
          </form>
        </Form>
      </PopoverContent>
    </Popover>
  );
}
