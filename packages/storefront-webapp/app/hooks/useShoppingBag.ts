import {
  addItemToBag,
  getActiveBag,
  removeItemFromBag,
  updateBagItem,
} from "@/api/bag";
import {
  addItemToSavedBag,
  getActiveSavedBag,
  removeItemFromSavedBag,
  updateSavedBagItem,
} from "@/api/savedBag";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import { bagQueries } from "@/queries";
import { ProductSku } from "@athena/webapp-2";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

type BagAction = "adding-to-bag" | "adding-to-saved-bag";

export const useShoppingBag = () => {
  const queryClient = useQueryClient();

  const [operationSuccessful, setOperationSuccessful] = useState(false);
  const [action, setAction] = useState<BagAction>("adding-to-bag");

  const userId =
    typeof window == "object"
      ? window.serverData.customerId || window.serverData.guestId
      : "1";

  const { data: savedBag } = useQuery(
    bagQueries.activeSavedBag({
      userId,
      organizationId: OG_ORGANIZTION_ID,
      storeId: OG_STORE_ID,
    })
  );

  const addNewSavedBagItemMutation = useMutation({
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
      addItemToSavedBag({
        customerId: userId!,
        organizationId: OG_ORGANIZTION_ID,
        storeId: OG_STORE_ID,
        productId,
        productSkuId,
        productSku,
        savedBagId: savedBag!._id,
        quantity,
      }),
    onSuccess: () => {
      setOperationSuccessful(true);
      queryClient.invalidateQueries({ queryKey: ["active-saved-bag"] });
    },
  });

  const updateSavedBagItemMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: number; quantity: number }) =>
      updateSavedBagItem({
        customerId: userId!,
        savedBagId: savedBag!._id,
        quantity,
        itemId,
        organizationId: OG_ORGANIZTION_ID,
        storeId: OG_STORE_ID,
      }),
    onSuccess: () => {
      setOperationSuccessful(true);
      queryClient.invalidateQueries({ queryKey: ["active-saved-bag"] });
    },
  });

  const removeSavedBagItemMutation = useMutation({
    mutationFn: ({ itemId }: { itemId: number }) =>
      removeItemFromSavedBag({
        customerId: userId!,
        savedBagId: savedBag!._id,
        itemId: itemId,
        organizationId: OG_ORGANIZTION_ID,
        storeId: OG_STORE_ID,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active-saved-bag"] });
    },
  });

  const updateSavedBag = async ({
    itemId,
    quantity,
  }: {
    itemId: number;
    quantity: number;
  }) => {
    setAction("adding-to-saved-bag");
    if (quantity == 0) return await deleteItemFromSavedBag(itemId);

    setOperationSuccessful(false);

    await updateSavedBagItemMutation.mutateAsync({ itemId, quantity });
  };

  const addProductToSavedBag = async ({
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
    setAction("adding-to-saved-bag");
    setOperationSuccessful(false);
    await addNewSavedBagItemMutation.mutateAsync({
      productId,
      quantity,
      productSkuId,
      productSku,
    });
  };

  const deleteItemFromSavedBag = async (itemId: number) => {
    await removeSavedBagItemMutation.mutateAsync({ itemId });
  };

  const savedBagCount =
    savedBag?.items?.reduce(
      (total: number, item: ProductSku) => total + item.quantity,
      0
    ) || 0;

  const isUpdatingSavedBag =
    addNewSavedBagItemMutation.isPending ||
    updateSavedBagItemMutation.isPending ||
    removeSavedBagItemMutation.isPending;

  const { data: bag } = useQuery(
    bagQueries.activeBag({
      userId,
      organizationId: OG_ORGANIZTION_ID,
      storeId: OG_STORE_ID,
    })
  );

  const addNewBagItem = useMutation({
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

  const updateBagItemMutation = useMutation({
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

  const removeBagItem = useMutation({
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
    setAction("adding-to-bag");
    if (quantity == 0) return await deleteItemFromBag(itemId);

    setOperationSuccessful(false);

    await updateBagItemMutation.mutateAsync({ itemId, quantity });
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
    setAction("adding-to-bag");
    setOperationSuccessful(false);
    await addNewBagItem.mutateAsync({
      productId,
      quantity,
      productSkuId,
      productSku,
    });
  };

  const deleteItemFromBag = async (itemId: number) => {
    await removeBagItem.mutateAsync({ itemId });
  };

  const bagCount =
    bag?.items?.reduce(
      (total: number, item: ProductSku) => total + item.quantity,
      0
    ) || 0;

  const isUpdatingBag =
    addNewBagItem.isPending ||
    updateBagItemMutation.isPending ||
    removeBagItem.isPending;

  const moveItemFromBagToSaved = async (item: ProductSku) => {
    await addProductToSavedBag({
      quantity: item.quantity,
      productId: item.productId,
      productSku: item.productSku,
      productSkuId: item.productSkuId,
    });

    await deleteItemFromBag(item._id);
  };

  const moveItemFromSavedToBag = async (item: ProductSku) => {
    await addProductToBag({
      quantity: item.quantity,
      productId: item.productId,
      productSku: item.productSku,
      productSkuId: item.productSkuId,
    });

    await deleteItemFromSavedBag(item._id);
  };

  return {
    bagAction: action,
    addProductToBag,
    bag,
    bagCount,
    deleteItemFromBag,
    isUpdatingBag,
    updateBag,
    savedBag,
    addProductToSavedBag,
    savedBagCount,
    deleteItemFromSavedBag,
    isUpdatingSavedBag,
    updateSavedBag,
    moveItemFromBagToSaved,
    moveItemFromSavedToBag,
    addedItemSuccessfully: operationSuccessful,
  };
};
