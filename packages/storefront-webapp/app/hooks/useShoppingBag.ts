import { addItemToBag, removeItemFromBag, updateBagItem } from "@/api/bag";
import { createCheckoutSession } from "@/api/checkoutSession";
import {
  addItemToSavedBag,
  removeItemFromSavedBag,
  updateSavedBagItem,
} from "@/api/savedBag";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import { bagQueries } from "@/queries";
import { ProductSku } from "@athena/webapp-2";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export type ShoppingBagAction =
  | "idle"
  | "adding-to-bag"
  | "adding-to-saved-bag"
  | "deleting-from-bag"
  | "deleting-from-saved-bag"
  | "moving-to-saved-bag"
  | "moving-to-bag";

type UnavailableProducts = {
  available: number;
  productSkuId: string;
}[];

export const useShoppingBag = () => {
  const queryClient = useQueryClient();

  const [operationSuccessful, setOperationSuccessful] = useState(false);
  const [action, setAction] = useState<ShoppingBagAction>("idle");
  const [unavailableProducts, setUnavailableProducts] =
    useState<UnavailableProducts>([]);

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
      queryClient.invalidateQueries({
        queryKey: bagQueries.activeSavedBagKey(),
      });
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
      queryClient.invalidateQueries({
        queryKey: bagQueries.activeSavedBagKey(),
      });
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
      queryClient.invalidateQueries({
        queryKey: bagQueries.activeSavedBagKey(),
      });
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
    setAction("deleting-from-saved-bag");
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
      queryClient.invalidateQueries({ queryKey: bagQueries.activeBagKey() });
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
      queryClient.invalidateQueries({ queryKey: bagQueries.activeBagKey() });
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
      queryClient.invalidateQueries({ queryKey: bagQueries.activeBagKey() });
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
    setAction("deleting-from-bag");
    await removeBagItem.mutateAsync({ itemId });
  };

  const bagCount =
    bag?.items?.reduce(
      (total: number, item: ProductSku) => total + item.quantity,
      0
    ) || 0;

  const bagSubtotal =
    bag?.items.reduce(
      (sum: number, item: ProductSku) =>
        sum + (item.price || 0) * item.quantity,
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

  const obtainCheckoutSessionMutation = useMutation({
    mutationFn: ({
      bagId,
      bagItems,
    }: {
      bagId: string;
      bagItems: { quantity: number; productSkuId: string }[];
    }) =>
      createCheckoutSession({
        bagId,
        customerId: userId!,
        storeId: OG_STORE_ID,
        organizationId: OG_ORGANIZTION_ID,
        bagItems,
      }),
    onSuccess: (res) => {
      setOperationSuccessful(true);
      // queryClient.invalidateQueries({
      //   queryKey: bagQueries.activeSavedBagKey(),
      // });
      console.log("res after post ->", res);
      if (res.unavailableProducts) {
        setUnavailableProducts(res.unavailableProducts);
      } else {
        setUnavailableProducts([]);
      }
    },
  });

  const areProductsUnavailable = unavailableProducts.some(
    (p) => p.available == 0
  );

  const obtainCheckoutSession = async ({
    bagId,
    bagItems,
  }: {
    bagId: string;
    bagItems: { quantity: number; productSkuId: string }[];
  }) => {
    setOperationSuccessful(false);
    return await obtainCheckoutSessionMutation.mutateAsync({
      bagId,
      bagItems,
    });
  };

  return {
    bagAction: action,
    addProductToBag,
    bag,
    bagCount,
    bagSubtotal,
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
    obtainCheckoutSession,
    unavailableProducts,
    areProductsUnavailable,
  };
};
