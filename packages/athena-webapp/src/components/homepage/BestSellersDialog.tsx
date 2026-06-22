import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { HomepageProductPickerDialog } from "./HomepageProductPickerDialog";
import type { Category, Product, ProductSku, Subcategory } from "~/types";

export function BestSellersDialog({
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

  const addBestSeller = useMutation(api.inventory.bestSeller.create);

  const handleAddBestSeller = async (productSku: ProductSku) => {
    if (!activeStore) return;

    await addBestSeller({
      productId: productSku.productId,
      productSkuId: productSku._id,
      storeId: activeStore._id,
    });

    setDialogOpen(false);
  };

  if (!activeStore) return null;

  return (
    <HomepageProductPickerDialog
      categories={categories as Category[] | undefined}
      currency={activeStore.currency}
      description="Select the exact SKU that should appear in the storefront best sellers list."
      onOpenChange={setDialogOpen}
      onSelectSku={handleAddBestSeller}
      open={dialogOpen}
      products={products as Product[] | undefined}
      searchId="homepage-best-seller-sku-search"
      selectLabel="Add SKU"
      subcategories={subcategories as Subcategory[] | undefined}
      title="Add best seller"
    />
  );
}
