import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import {
  CommandDialog,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Product, ProductSku } from "~/types";
import { getProductName } from "~/src/lib/productUtils";

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

  const addBestSeller = useMutation(api.inventory.bestSeller.create);

  const handleAddBestSeller = async (productSku: any) => {
    if (!activeStore) return;

    addBestSeller({
      productId: productSku.productId,
      productSkuId: productSku._id,
      storeId: activeStore._id,
    });

    setDialogOpen(false);
  };

  const productSkus =
    products?.flatMap((product: Product) => product.skus) || [];

  if (!activeStore || !products) return null;

  return (
    <>
      <CommandDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <CommandList>
          <CommandGroup heading="Products">
            <div className="space-y-4">
              {productSkus?.map((product: ProductSku) => (
                <CommandItem key={product._id}>
                  <div
                    className="flex h-[80px] items-center gap-2 w-full"
                    onClick={() => handleAddBestSeller(product)}
                  >
                    {product.images[0] ? (
                      <img
                        src={product.images[0]}
                        alt={product?.productName}
                        className="w-16 h-16 rounded-md"
                      />
                    ) : (
                      <div className="aspect-square w-16 h-16 bg-gray-100 rounded-md" />
                    )}
                    <p>{getProductName(product)}</p>
                  </div>
                </CommandItem>
              ))}
            </div>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
