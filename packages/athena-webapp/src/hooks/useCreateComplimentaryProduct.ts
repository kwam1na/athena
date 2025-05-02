import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import useGetActiveStore from "./useGetActiveStore";

export function useCreateComplimentaryProduct() {
  const { activeStore } = useGetActiveStore();
  const create = useMutation(
    api.inventory.complimentaryProduct.createComplimentaryProduct
  );

  return async (
    productSkuId: Id<"productSku">,
    createdByUserId: Id<"athenaUser">
  ) => {
    await create({
      storeId: activeStore?._id as Id<"store">,
      organizationId: activeStore?.organizationId as Id<"organization">,
      productSkuId,
      isActive: true,
      createdByUserId,
    });
  };
}
