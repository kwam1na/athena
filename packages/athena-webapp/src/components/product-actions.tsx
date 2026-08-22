import { useMutation } from "convex/react";
import useGetActiveStore from "../hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import {
  ProductArchiveBlockedError,
  productArchiveBlockFromResult,
} from "../lib/errors/productArchiveFailure";

export const useArchiveProduct = (productId: Id<"product">) => {
  const archiveProduct = useMutation(api.inventory.products.archive);
  const { activeStore } = useGetActiveStore();

  return async () => {
    const result = await archiveProduct({
      id: productId,
      storeId: activeStore!._id,
    });

    // A declined archive comes back as a command result so the server-side
    // decision stays audited; the browser turns it into a typed failure.
    const block = productArchiveBlockFromResult(result);
    if (block) throw new ProductArchiveBlockedError(block);

    return result;
  };
};

export const useDeleteProduct = useArchiveProduct;
