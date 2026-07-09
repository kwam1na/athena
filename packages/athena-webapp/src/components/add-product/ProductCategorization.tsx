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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "../ui/button";
import { useEffect, useState } from "react";
import CategorySubcategoryManager, {
  CategoryManageOption,
} from "./CategorySubcategoryManager";
import { Plus } from "lucide-react";
import { useProduct } from "@/contexts/ProductContext";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { Input } from "../ui/input";
import { getProductName } from "~/src/lib/productUtils";
import { FadeIn } from "../common/FadeIn";
import { Switch } from "../ui/switch";
import { useSearch } from "@tanstack/react-router";
import { formatTaxonomySelectOptionLabel } from "./taxonomySelectLabels";

function ProductCategorization({
  setInitialSelectedOption,
}: {
  setInitialSelectedOption: (option: CategoryManageOption) => void;
}) {
  const {
    activeProduct,
    showLoaderForProduct,
    productData,
    trustedInventoryFinalizedSkuIds,
    updateProductData,
  } = useProduct();

  const { activeStore } = useGetActiveStore();

  const categoriesData = useQuery(
    api.inventory.categories.getAll,
    activeStore ? { storeId: activeStore._id } : "skip",
  );

  const subcategoriesData = useQuery(
    api.inventory.subcategories.getAll,
    activeStore ? { storeId: activeStore._id } : "skip",
  );

  const { categorySlug } = useSearch({ strict: false });

  const categoryInSearch = categoriesData?.find((c) => c.slug === categorySlug);

  useEffect(() => {
    if (categoryInSearch) {
      updateProductData({
        categoryId: categoryInSearch._id,
        categoryName: categoryInSearch.name,
        categorySlug: categoryInSearch.slug,
      });
    }
  }, [categoryInSearch, updateProductData]);

  const categories =
    categoriesData
      ?.map((category) => ({
        name: category.name,
        displayName: formatTaxonomySelectOptionLabel(category.name),
        id: category._id,
        slug: category.slug,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)) || [];

  const subcategories =
    subcategoriesData
      ?.map((subcategory) => ({
        name: subcategory.name,
        displayName: formatTaxonomySelectOptionLabel(subcategory.name),
        id: subcategory._id,
        slug: subcategory.slug,
        categoryId: subcategory.categoryId,
      }))
      .filter(
        (subcategory) => subcategory.categoryId === productData.categoryId,
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName)) || [];

  const shouldShowCatalogSetupRequirement =
    trustedInventoryFinalizedSkuIds.size > 0 &&
    activeProduct?.categorySlug === "legacy-import" &&
    (productData.categorySlug === "legacy-import" ||
      !productData.categorySlug ||
      !productData.subcategorySlug);

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
              className="text-muted-foreground text-xs"
            >
              <Plus className="w-3 h-3 mr-2" />
              New
            </Button>
          </div>
          {showLoaderForProduct ? null : (
            <Select
              onValueChange={(value: string) => {
                const selectedCategory = categories.find(
                  (category) => category.id === value,
                );
                updateProductData({
                  categoryId: value as Id<"category">,
                  categoryName: selectedCategory?.name,
                  categorySlug: selectedCategory?.slug,
                  subcategoryId: undefined,
                  subcategoryName: undefined,
                  subcategorySlug: undefined,
                });
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
                        {category.displayName}
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
              className="text-muted-foreground text-xs"
            >
              <Plus className="w-3 h-3 mr-2" />
              New
            </Button>
          </div>
          {showLoaderForProduct ? null : (
            <Select
              onValueChange={(value: string) => {
                const selectedSubcategory = subcategories.find(
                  (subcategory) => subcategory.id === value,
                );
                updateProductData({
                  subcategoryId: value as Id<"subcategory">,
                  subcategoryName: selectedSubcategory?.name,
                  subcategorySlug: selectedSubcategory?.slug,
                });
              }}
              value={productData.subcategoryId?.toString()}
            >
              <SelectTrigger
                id="subcategory"
                aria-label="Select subcategory"
                disabled={!productData.categoryId}
              >
                <SelectValue placeholder="Select subcategory" />
              </SelectTrigger>
              <SelectContent>
                {subcategories.map((subcategory) => {
                  return (
                    <SelectItem key={subcategory.id} value={subcategory.id}>
                      {subcategory.displayName}
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
      {shouldShowCatalogSetupRequirement ? (
        <p className="px-4 pb-4 text-xs leading-5 text-amber-500">
          Catalog setup required. Assign an Athena category and subcategory
          before saving.
        </p>
      ) : null}
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

  const {
    productData,
    updateProductData,
    showLoaderForProduct,
    activeProductVariant,
  } = useProduct();

  const updateProduct = useMutation(api.inventory.products.update);

  const handleProductVisibility = async (checked: boolean) => {
    if (!productData._id) return;
    updateProductData({ isVisible: checked });

    await updateProduct({
      id: productData._id,
      isVisible: checked,
    });
  };

  const handleProductPosVisibility = async (checked: boolean) => {
    if (!productData._id) return;
    updateProductData({ posVisible: checked });

    await updateProduct({
      id: productData._id,
      posVisible: checked,
    });
  };

  return (
    <View
      fullHeight={false}
      lockDocumentScroll={false}
      hideBorder
      hideHeaderBottomBorder
      header={
        <div className="flex items-center justify-between">
          <p className="text-sm text-sm">Details</p>
        </div>
      }
    >
      <CategorizationManagerDialog
        open={dialogOptions.isOpen}
        initialSelectedOption={dialogOptions.initialSelected}
        onClose={() => setDialogOptions((prev) => ({ ...prev, isOpen: false }))}
      />
      <div className="space-y-4 px-4 pt-4">
        <Label className="text-muted-foreground" htmlFor="name">
          Name
        </Label>

        {showLoaderForProduct ? null : (
          <Input
            value={productData.name || ""}
            onChange={(e) => updateProductData({ name: e.target.value })}
          />
        )}

        {!showLoaderForProduct && productData.name && (
          <FadeIn className="flex items-center gap-1 py-2">
            <p className="text-sm text-muted-foreground">Displays as</p>
            <b className="text-sm">
              {getProductName({
                productCategory: productData.categoryName,
                productName: productData.name,
                length: activeProductVariant.length,
                colorName: activeProductVariant.colorName,
              })}
            </b>
          </FadeIn>
        )}
      </div>

      {productData._id && (
        <div className="flex items-center gap-6 px-4 pt-4">
          <div className="flex items-center gap-3">
            <Label htmlFor="storefront-visibility-toggle">
              Available on online store
            </Label>
            <Switch
              id="storefront-visibility-toggle"
              checked={productData.isVisible !== false}
              onCheckedChange={handleProductVisibility}
            />
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="pos-visibility-toggle">Available in POS</Label>
            <Switch
              id="pos-visibility-toggle"
              checked={productData.posVisible !== false}
              onCheckedChange={handleProductPosVisibility}
            />
          </div>
        </div>
      )}

      <ProductCategorization
        setInitialSelectedOption={setInitialSelectedOption}
      />
    </View>
  );
}
