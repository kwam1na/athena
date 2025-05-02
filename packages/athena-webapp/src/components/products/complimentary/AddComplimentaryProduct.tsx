import { api } from "~/convex/_generated/api";

import { useGetProducts } from "~/src/hooks/useGetProducts";
import {
  SelectedProductsProvider,
  useSelectedProducts,
} from "../../base/selectable-products-table/selectable-data-provider";
import { FadeIn } from "../../common/FadeIn";
import PageHeader, { SimplePageHeader } from "../../common/PageHeader";
import { SelectableProductsTable } from "../../promo-codes/selectable-products-table/data-table";
import View from "../../View";
import { Product, ProductSku } from "~/types";
import { currencyFormatter } from "~/src/lib/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { selectableProductColumns } from "../../base/selectable-products-table/columns";
import { Button } from "../../ui/button";
import { PlusIcon } from "lucide-react";
import { useMutation } from "convex/react";
import { useState } from "react";
import { useAuth } from "~/src/hooks/useAuth";
import { LoadingButton } from "../../ui/loading-button";
import { toast } from "sonner";

const SelectedProducts = () => {
  const { selectedProductSkus, setSelectedProductSkus } = useSelectedProducts();

  const batchCreateComplimentaryProducts = useMutation(
    api.inventory.complimentaryProduct.batchCreateComplimentaryProducts
  );

  const { activeStore } = useGetActiveStore();

  const { user } = useAuth();

  const [isCreatingComplimentaryProducts, setIsCreatingComplimentaryProducts] =
    useState(false);

  if (selectedProductSkus.size === 0 || !activeStore || !user) return null;

  const handleAddComplimentaryProducts = async () => {
    try {
      setIsCreatingComplimentaryProducts(true);
      await batchCreateComplimentaryProducts({
        productSkuIds: Array.from(selectedProductSkus).map((sku) => sku._id),
        storeId: activeStore._id,
        organizationId: activeStore.organizationId,
        isActive: true,
        createdByUserId: user._id,
      });
      toast.success("Complimentary products added successfully");
      setSelectedProductSkus(new Set<ProductSku>());
    } catch (error) {
      toast.error("Failed to add complimentary products", {
        description: (error as Error).message,
      });
    } finally {
      setIsCreatingComplimentaryProducts(false);
    }
  };

  return (
    <View
      header={
        <PageHeader>
          <p className="text-sm">Selected products</p>
        </PageHeader>
      }
    >
      <div className="p-4 space-y-8">
        <div className="flex items-center gap-8">
          {Array.from(selectedProductSkus).map((sku) => (
            <img
              key={sku._id}
              src={sku.images[0]}
              className="w-24 h-24 aspect-square object-cover rounded-lg"
            />
          ))}
        </div>
        <Button
          disabled={isCreatingComplimentaryProducts}
          onClick={handleAddComplimentaryProducts}
        >
          Add selected ({selectedProductSkus.size})
        </Button>
      </div>
    </View>
  );
};

const Body = () => {
  const products = useGetProducts();

  const { activeStore } = useGetActiveStore();

  const { selectedProductSkus } = useSelectedProducts();

  if (!products || !activeStore) return null;

  const formatter = currencyFormatter(activeStore.currency);

  const productsFormatted: any[] = products.map((product: Product) => {
    const p = {
      ...product,
      skus: product.skus.map((sku) => {
        return {
          ...sku,
          price: formatter.format(sku.price),
        };
      }),
    };

    return p;
  });

  return (
    <View header={<SimplePageHeader title="Add complimentary product" />}>
      <FadeIn className="container mx-auto h-full w-full p-8 space-y-12">
        <SelectedProducts />
        <SelectableProductsTable
          data={productsFormatted}
          columns={selectableProductColumns}
        />
      </FadeIn>
    </View>
  );
};

export const AddComplimentaryProduct = () => {
  return (
    <SelectedProductsProvider>
      <Body />
    </SelectedProductsProvider>
  );
};
