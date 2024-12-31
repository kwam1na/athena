import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import {
  CommandDialog,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command";

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

  const handleAddBestSeller = async (product: any) => {
    if (!activeStore) return;

    addBestSeller({
      productId: product._id,
      storeId: activeStore._id,
    });

    setDialogOpen(false);
  };

  if (!activeStore || !products) return null;

  return (
    <>
      <CommandDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <CommandList>
          <CommandGroup heading="Products">
            {products?.map((product: any) => (
              <CommandItem key={product._id}>
                <div
                  className="flex items-center gap-2 w-full"
                  onClick={() => handleAddBestSeller(product)}
                >
                  <img
                    src={product?.skus[0].images[0]}
                    alt={product?.name}
                    className="w-8 h-8 rounded-md"
                  />
                  <p>{product.name}</p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
