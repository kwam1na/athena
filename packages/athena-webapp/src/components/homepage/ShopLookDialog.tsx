import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import {
  CommandDialog,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command";
import { capitalizeWords } from "~/src/lib/utils";
import { Id } from "~/convex/_generated/dataModel";

export function ShopLookDialog({
  action,
  featuredItemId,
  dialogOpen,
  setDialogOpen,
}: {
  action: "add" | "edit";
  featuredItemId?: string;
  dialogOpen: boolean;
  setDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { activeStore } = useGetActiveStore();

  const products = useQuery(
    api.inventory.products.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const addFeaturedItem = useMutation(api.inventory.featuredItem.create);

  const removeHighlightedItem = useMutation(api.inventory.featuredItem.remove);

  const handleAddFeaturedItem = async (item: any) => {
    if (!activeStore) return;

    if (action === "edit" && featuredItemId) {
      removeHighlightedItem({ id: featuredItemId as Id<"featuredItem"> });
    }

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
                  {product?.skus[0].images[0] ? (
                    <img
                      src={product?.skus[0].images[0]}
                      alt={product?.name}
                      className="w-16 h-16 rounded-md"
                    />
                  ) : (
                    <div className="aspect-square w-16 h-16 bg-gray-100 rounded-md" />
                  )}
                  <p>{capitalizeWords(product.name)}</p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
