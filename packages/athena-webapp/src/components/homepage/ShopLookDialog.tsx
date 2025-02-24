import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import {
  CommandDialog,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command";

export function ShopLookDialog({
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

  const addFeaturedItem = useMutation(api.inventory.featuredItem.create);

  const handleAddFeaturedItem = async (item: any) => {
    if (!activeStore) return;

    addFeaturedItem({
      productId: item._id,
      type: "shop_look",
      storeId: activeStore._id,
    });

    setDialogOpen(false);
  };

  if (!activeStore) return null;

  return (
    <>
      <CommandDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <CommandList>
          <CommandGroup heading="Products">
            {products?.map((product: any) => (
              <CommandItem key={product._id}>
                <div
                  className="flex items-center gap-2 w-full"
                  onClick={() => handleAddFeaturedItem(product)}
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
