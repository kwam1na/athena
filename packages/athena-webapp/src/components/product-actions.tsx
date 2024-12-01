import { useMutation } from "convex/react";
import useGetActiveStore from "../hooks/useGetActiveStore";
import { deleteDirectoryInS3 } from "../lib/aws";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { toast } from "sonner";
import { Ban } from "lucide-react";

export const useDeleteProduct = (productId: Id<"product">) => {
  const deleteProduct = useMutation(api.inventory.products.remove);
  const { activeStore } = useGetActiveStore();

  return async () => {
    await deleteProduct({ id: productId });
    await deleteDirectoryInS3(
      `stores/${activeStore?._id}/products/${productId}`
    );
  };
};
