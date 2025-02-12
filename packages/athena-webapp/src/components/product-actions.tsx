import { useAction } from "convex/react";
import useGetActiveStore from "../hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";

export const useDeleteProduct = (productId: Id<"product">) => {
  const deleteProduct = useAction(api.inventory.products.clear);
  const { activeStore } = useGetActiveStore();

  return async () => {
    await deleteProduct({ id: productId, storeId: activeStore!._id });
  };
};
