import { useMutation } from "convex/react";
import useGetActiveStore from "../hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";

export const useArchiveProduct = (productId: Id<"product">) => {
  const archiveProduct = useMutation(api.inventory.products.archive);
  const { activeStore } = useGetActiveStore();

  return async () => {
    await archiveProduct({ id: productId, storeId: activeStore!._id });
  };
};

export const useDeleteProduct = useArchiveProduct;
