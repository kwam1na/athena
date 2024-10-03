import {
  addItemToBag,
  getActiveBag,
  removeItemFromBag,
  updateBagItem,
} from "@/api/bag";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export const useShoppingBag = () => {
  const queryClient = useQueryClient();

  const userId =
    typeof window == "object"
      ? window.serverData.customerId || window.serverData.guestId
      : "1";

  const { data: bag } = useQuery({
    queryKey: ["active-bag"],
    queryFn: () => getActiveBag(parseInt(userId!)),
    enabled: Boolean(userId),
  });

  const addNewItem = useMutation({
    mutationFn: ({
      productId,
      quantity,
      price,
    }: {
      productId: number;
      quantity: number;
      price: number;
    }) =>
      addItemToBag({
        customerId: 1,
        price,
        productId,
        bagId: bag!.id,
        quantity,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active-bag"] });
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: number; quantity: number }) =>
      updateBagItem({ customerId: 1, bagId: bag!.id, quantity, itemId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active-bag"] });
    },
  });

  const removeItem = useMutation({
    mutationFn: ({ itemId }: { itemId: number }) =>
      removeItemFromBag({
        customerId: parseInt(userId!),
        bagId: bag!.id,
        itemId: itemId,
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
    await updateItemMutation.mutateAsync({ itemId, quantity });
  };

  const addProductToBag = async ({
    price,
    quantity,
    productId,
  }: {
    price: number;
    quantity: number;
    productId: number;
  }) => {
    await addNewItem.mutateAsync({
      productId,
      price,
      quantity,
    });
  };

  const deleteItemFromBag = async (itemId: number) => {
    await removeItem.mutateAsync({ itemId });
  };

  const bagCount =
    bag?.items?.reduce((total, item) => total + item.quantity, 0) || 0;

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
  };
};
