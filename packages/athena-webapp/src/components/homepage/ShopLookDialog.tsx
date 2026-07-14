import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { Id } from "~/convex/_generated/dataModel";
import { HomepageProductPickerDialog } from "./HomepageProductPickerDialog";
import type { Category, Product, Subcategory } from "~/types";

export function ShopLookDialog({
  action,
  disabled = false,
  featuredItemId,
  dialogOpen,
  setDialogOpen,
}: {
  action: "add" | "edit";
  disabled?: boolean;
  featuredItemId?: string;
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

  const removeHighlightedItem = useMutation(api.inventory.featuredItem.remove);

  const handleAddFeaturedItem = async (item: Product) => {
    if (!activeStore) return;

    if (action === "edit" && featuredItemId) {
      await removeHighlightedItem({ id: featuredItemId as Id<"featuredItem"> });
    }

    await addFeaturedItem({
      productId: item._id,
      type: "shop_look",
      storeId: activeStore._id,
    });

    setDialogOpen(false);
  };

  if (!activeStore) return null;

  return (
    <HomepageProductPickerDialog
      categories={categories as Category[] | undefined}
      currency={activeStore.currency}
      description="Select the product that should anchor the Shop the Look story."
      disabled={disabled}
      onOpenChange={setDialogOpen}
      onSelectProduct={handleAddFeaturedItem}
      open={dialogOpen}
      products={products as Product[] | undefined}
      searchId="homepage-shop-look-sku-search"
      selectLabel={action === "edit" ? "Replace product" : "Add product"}
      subcategories={subcategories as Subcategory[] | undefined}
      title={action === "edit" ? "Replace Shop the Look product" : "Add Shop the Look product"}
    />
  );
}
