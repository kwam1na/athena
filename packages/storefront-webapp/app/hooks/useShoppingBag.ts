import {
  addItemToBag,
  getActiveBag,
  removeItemFromBag,
  updateBagItem,
} from "@/api/bag";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import { ProductSku } from "@athena/webapp-2";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export const useShoppingBag = () => {
  const queryClient = useQueryClient();

  const [operationSuccessful, setOperationSuccessful] = useState(false);

  const userId =
    typeof window == "object"
      ? window.serverData.customerId || window.serverData.guestId
      : "1";

  const { data: bag } = useQuery({
    queryKey: ["active-bag"],
    queryFn: () =>
      getActiveBag({
        customerId: userId!,
        organizationId: OG_ORGANIZTION_ID,
        storeId: OG_STORE_ID,
      }),
    enabled: Boolean(userId),
  });

  const addNewItem = useMutation({
    mutationFn: ({
      productId,
      productSkuId,
      productSku,
      quantity,
    }: {
      productId: string;
      productSkuId: string;
      productSku: string;
      quantity: number;
    }) =>
      addItemToBag({
        customerId: userId!,
        organizationId: OG_ORGANIZTION_ID,
        storeId: OG_STORE_ID,
        productId,
        productSkuId,
        productSku,
        bagId: bag!._id,
        quantity,
      }),
    onSuccess: () => {
      setOperationSuccessful(true);
      queryClient.invalidateQueries({ queryKey: ["active-bag"] });
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: number; quantity: number }) =>
      updateBagItem({
        customerId: userId!,
        bagId: bag!._id,
        quantity,
        itemId,
        organizationId: OG_ORGANIZTION_ID,
        storeId: OG_STORE_ID,
      }),
    onSuccess: () => {
      setOperationSuccessful(true);
      queryClient.invalidateQueries({ queryKey: ["active-bag"] });
    },
  });

  const removeItem = useMutation({
    mutationFn: ({ itemId }: { itemId: number }) =>
      removeItemFromBag({
        customerId: userId!,
        bagId: bag!._id,
        itemId: itemId,
        organizationId: OG_ORGANIZTION_ID,
        storeId: OG_STORE_ID,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active-bag"] });
    },
  });

  const updateBag = async ({
    itemId,
    quantity,
  }: {
    itemId: number;
    quantity: number;
  }) => {
    if (quantity == 0) return await deleteItemFromBag(itemId);

    setOperationSuccessful(false);

    await updateItemMutation.mutateAsync({ itemId, quantity });
  };

  const addProductToBag = async ({
    quantity,
    productId,
    productSkuId,
    productSku,
  }: {
    quantity: number;
    productId: string;
    productSkuId: string;
    productSku: string;
  }) => {
    setOperationSuccessful(false);
    await addNewItem.mutateAsync({
      productId,
      quantity,
      productSkuId,
      productSku,
    });
  };

  const deleteItemFromBag = async (itemId: number) => {
    await removeItem.mutateAsync({ itemId });
  };

  const bagCount =
    bag?.items?.reduce(
      (total: number, item: ProductSku) => total + item.quantity,
      0
    ) || 0;

  const isUpdatingBag =
    addNewItem.isPending ||
    updateItemMutation.isPending ||
    removeItem.isPending;

  return {
    addProductToBag,
    bag,
    bagCount,
    deleteItemFromBag,
    isUpdatingBag,
    updateBag,
    addedItemSuccessfully: operationSuccessful,
  };
};
