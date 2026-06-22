import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
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
      categories={categories as Category[] | undefined}
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
      subcategories={subcategories as Subcategory[] | undefined}
      title="Add highlighted content"
    />
  );
}
