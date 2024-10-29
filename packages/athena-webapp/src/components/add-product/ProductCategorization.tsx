import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import View from "../View";
import { getErrorForField } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "../ui/button";
import { useState } from "react";
import CategorySubcategoryManager, {
  CategoryManageOption,
} from "./CategorySubcategoryManager";
import { CogIcon, Plus } from "lucide-react";
import { Skeleton } from "../ui/skeleton";
import { useProduct } from "@/contexts/ProductContext";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";

function ProductCategorization({
  setInitialSelectedOption,
}: {
  setInitialSelectedOption: (option: CategoryManageOption) => void;
}) {
  const categoryId = "categoryId";
  const subcategoryId = "subcategoryId";

  const { error, isLoading, productData, updateProductData } = useProduct();

  const categoryError = getErrorForField(error, categoryId);
  const subcategoryError = getErrorForField(error, subcategoryId);

  const { activeStore } = useGetActiveStore();

  const categoriesData = useQuery(
    api.inventory.categories.getAll,
    activeStore ? { storeId: activeStore._id } : "skip"
  );

  const subcategoriesData = useQuery(
    api.inventory.subcategories.getAll,
    activeStore ? { storeId: activeStore._id } : "skip"
  );

  const categories =
    categoriesData?.map((category) => ({
      name: category.name,
      id: category._id,
    })) || [];

  const subcategories =
    subcategoriesData?.map((subcategory) => ({
      name: subcategory.name,
      id: subcategory._id,
    })) || [];

  const showCategoriesSkeleton = isLoading;
  const showSubcategoriesSkeleton = isLoading;

  return (
    <>
      <div className="flex gap-8 px-4 py-8">
        <div className="flex flex-col gap-2 w-[50%]">
          <div className="w-full flex justify-between items-center">
            <Label className="text-muted-foreground" htmlFor="category">
              Category
            </Label>
            <Button
              onClick={() => setInitialSelectedOption("category")}
              variant={"ghost"}
              className="text-muted-foreground"
            >
              <Plus className="w-3 h-3 mr-2" />
              New
            </Button>
          </div>
          {showCategoriesSkeleton && <Skeleton className="h-[40px]" />}
          {!showCategoriesSkeleton && (
            <Select
              onValueChange={(value: string) => {
                updateProductData({ categoryId: value as Id<"category"> });
              }}
              value={productData.categoryId?.toString()}
            >
              <SelectTrigger id="category" aria-label="Select category">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>

              <SelectContent>
                <SelectGroup>
                  {categories.map((category) => {
                    return (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          {/* {(categoryError || fetchCategoriesError) && (
            <p className="text-red-500 text-sm font-medium">
              {categoryError?.message || fetchCategoriesError?.message}
            </p>
          )} */}
        </div>
        <div className="flex flex-col gap-2 w-[50%]">
          <div className="w-full flex justify-between items-center">
            <Label className="text-muted-foreground" htmlFor="subcategory">
              Subcategory
            </Label>
            <Button
              onClick={() => setInitialSelectedOption("subcategory")}
              variant={"ghost"}
              className="text-muted-foreground"
            >
              <Plus className="w-3 h-3 mr-2" />
              New
            </Button>
          </div>
          {showSubcategoriesSkeleton && <Skeleton className="h-[40px]" />}
          {!showSubcategoriesSkeleton && (
            <Select
              onValueChange={(value: string) => {
                updateProductData({
                  subcategoryId: value as Id<"subcategory">,
                });
              }}
              value={productData.subcategoryId?.toString()}
            >
              <SelectTrigger id="subcategory" aria-label="Select subcategory">
                <SelectValue placeholder="Select subcategory" />
              </SelectTrigger>
              <SelectContent>
                {subcategories.map((subcategory) => {
                  return (
                    <SelectItem key={subcategory.id} value={subcategory.id}>
                      {subcategory.name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
          {/* {(subcategoryError || fetchSubategoriesError) && (
            <p className="text-red-500 text-sm font-medium">
              {subcategoryError?.message || fetchSubategoriesError?.message}
            </p>
          )} */}
        </div>
      </div>
    </>
  );
}

function CategorizationManagerDialog({
  initialSelectedOption,
  open,
  onClose,
}: {
  initialSelectedOption?: CategoryManageOption;
  open: boolean;
  onClose: () => void;
}) {
  const handleClose = () => {
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Manage`}</DialogTitle>
        </DialogHeader>
        <CategorySubcategoryManager
          initialSelectedOption={initialSelectedOption}
        />
      </DialogContent>
    </Dialog>
  );
}

export function ProductCategorizationView() {
  const [dialogOptions, setDialogOptions] = useState<{
    isOpen: boolean;
    initialSelected: CategoryManageOption;
  }>({
    isOpen: false,
    initialSelected: "category",
  });

  const setInitialSelectedOption = (option: CategoryManageOption) => {
    setDialogOptions({ isOpen: true, initialSelected: option });
  };

  return (
    <View
      className="h-auto"
      header={
        <div className="flex items-center justify-between">
          <p className="text-sm text-sm text-muted-foreground">
            Categorization
          </p>
          <div className="space-x-2">
            <Button
              className="text-muted-foreground"
              variant={"ghost"}
              size={"icon"}
              onClick={() =>
                setDialogOptions((prev) => ({ ...prev, isOpen: true }))
              }
            >
              <CogIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>
      }
    >
      <CategorizationManagerDialog
        open={dialogOptions.isOpen}
        initialSelectedOption={dialogOptions.initialSelected}
        onClose={() => setDialogOptions((prev) => ({ ...prev, isOpen: false }))}
      />
      <ProductCategorization
        setInitialSelectedOption={setInitialSelectedOption}
      />
    </View>
  );
}
