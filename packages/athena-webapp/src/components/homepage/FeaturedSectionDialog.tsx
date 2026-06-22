import { useMutation, useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import {
  isStorefrontSelectableSubcategory,
  isStorefrontVisibleCategory,
} from "~/shared/storefrontVisibility";
import { HomepageProductPickerDialog } from "./HomepageProductPickerDialog";
import type { Category, Product, Subcategory } from "~/types";

export function FeaturedSectionDialog({
  dialogOpen,
  setDialogOpen,
}: {
  dialogOpen: boolean;
  setDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { activeStore } = useGetActiveStore();

  const products = useQuery(
    api.inventory.products.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const categories = useQuery(
    api.inventory.categories.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const subcategories = useQuery(
    api.inventory.subcategories.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const addFeaturedItem = useMutation(api.inventory.featuredItem.create);

  const storefrontVisibleCategories = useMemo(() => {
    return (categories as Category[] | undefined)?.filter((category) =>
      isStorefrontVisibleCategory(category),
    );
  }, [categories]);

  const storefrontVisibleSubcategories = useMemo(() => {
    const categoryById = new Map(
      (categories as Category[] | undefined)?.map((category) => [
        category._id,
        category,
      ]) ?? [],
    );

    return (subcategories as Subcategory[] | undefined)?.filter(
      (subcategory) =>
        isStorefrontSelectableSubcategory(
          subcategory,
          categoryById.get(subcategory.categoryId),
        ),
    );
  }, [categories, subcategories]);

  const handleAddProduct = async (product: Product) => {
    if (!activeStore) return;

    await addFeaturedItem({
      productId: product._id,
      storeId: activeStore._id,
      type: "regular",
    });

    setDialogOpen(false);
  };

  const handleAddCategory = async (category: Category) => {
    if (!activeStore) return;

    await addFeaturedItem({
      categoryId: category._id,
      storeId: activeStore._id,
      type: "regular",
    });

    setDialogOpen(false);
  };

  const handleAddSubcategory = async (subcategory: Subcategory) => {
    if (!activeStore) return;

    await addFeaturedItem({
      subcategoryId: subcategory._id,
      storeId: activeStore._id,
      type: "regular",
    });

    setDialogOpen(false);
  };

  if (!activeStore) return null;

  return (
    <HomepageProductPickerDialog
      categories={storefrontVisibleCategories}
      currency={activeStore.currency}
      description="Select a product, category, or subcategory to feature below the homepage hero."
      onOpenChange={setDialogOpen}
      onSelectCategory={handleAddCategory}
      onSelectProduct={handleAddProduct}
      onSelectSubcategory={handleAddSubcategory}
      open={dialogOpen}
      products={products as Product[] | undefined}
      searchId="homepage-highlighted-sku-search"
      selectLabel="Feature product"
      showCollections
      subcategories={storefrontVisibleSubcategories}
      title="Add highlighted content"
    />
  );
}
