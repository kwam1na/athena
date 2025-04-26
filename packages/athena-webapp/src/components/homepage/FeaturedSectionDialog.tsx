import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import {
  CommandDialog,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command";

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

  const handleAddFeaturedItem = async (
    item: any,
    type: "category" | "subcategory" | "product"
  ) => {
    if (!activeStore) return;

    let productId, categoryId, subcategoryId;

    switch (type) {
      case "category":
        categoryId = item._id;
        break;

      case "subcategory":
        subcategoryId = item._id;
        break;

      case "product":
        productId = item._id;
        break;

      default:
        break;
    }

    addFeaturedItem({
      productId,
      categoryId,
      subcategoryId,
      storeId: activeStore._id,
      type: "regular",
    });

    setDialogOpen(false);
  };

  if (!activeStore) return null;

  return (
    <>
      <CommandDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <CommandList>
          <CommandGroup heading="Categories">
            {categories?.map((category: any) => (
              <CommandItem key={category._id}>
                <div
                  className="flex items-center gap-2 w-full"
                  onClick={() => handleAddFeaturedItem(category, "category")}
                >
                  <p>{category.name}</p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="Subcategories">
            {subcategories?.map((subcategory: any) => (
              <CommandItem key={subcategory._id}>
                <div
                  className="flex items-center gap-2 w-full"
                  onClick={() =>
                    handleAddFeaturedItem(subcategory, "subcategory")
                  }
                >
                  <p>{subcategory.name}</p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="Products">
            {products?.map((product: any) => (
              <CommandItem key={product._id}>
                <div
                  className="flex items-center gap-2 w-full"
                  onClick={() => handleAddFeaturedItem(product, "product")}
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
