import {
  addItemToBag,
  clearBag,
  removeItemFromBag,
  updateBagItem,
} from "@/api/bag";
import {
  createCheckoutSession,
  updateCheckoutSession as updateCheckoutSessionAPI,
} from "@/api/checkoutSession";
import type { CheckoutOrderSubmission } from "@/components/checkout/schemas/webOrderSchema";
import {
  addItemToSavedBag,
  removeItemFromSavedBag,
  updateSavedBagItem,
} from "@/api/savedBag";
import { useBagQueries } from "@/lib/queries/bag";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";
import {
  BagItem,
  ProductSku,
  PromoCodeItem,
  SavedBagItem,
} from "@athena/webapp";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useStorefrontObservability } from "@/hooks/useStorefrontObservability";
import { emitStorefrontFailure } from "@/lib/storefrontFailureObservability";

export type ShoppingBagAction =
  | "idle"
  | "adding-to-bag"
  | "adding-to-saved-bag"
  | "deleting-from-bag"
  | "clearing-bag"
  | "deleting-from-saved-bag"
  | "moving-to-saved-bag"
  | "moving-to-bag";

type UnavailableProducts = {
  available: number;
  productSkuId: string;
}[];

export type Discount = {
  id: string;
  code: string;
  type: "percentage" | "amount";
  value: number;
};

export const useShoppingBag = () => {
  const queryClient = useQueryClient();
  const { baseContext, track } = useStorefrontObservability();

  const [operationSuccessful, setOperationSuccessful] = useState<
    boolean | null
  >(null);
  const [action, setAction] = useState<ShoppingBagAction>("idle");
  const [unavailableProducts, setUnavailableProducts] =
    useState<UnavailableProducts>([]);

  const bagQueries = useBagQueries();

  const { data: savedBag } = useQuery(bagQueries.activeSavedBag());

  const { data: bag } = useQuery(bagQueries.activeBag());

  const promoCodeQueries = usePromoCodesQueries();

  const { data: promoCodeItems } = useQuery(promoCodeQueries.getAllItems());

  const reportFailure = ({
    step,
    error,
    context,
  }: {
    step:
      | "bag_item_addition"
      | "bag_item_update"
      | "bag_item_removal"
      | "bag_clear"
      | "checkout_session_creation"
      | "payment_submission";
    error: unknown;
    context?: Record<string, unknown>;
  }) => {
    void emitStorefrontFailure({
      route: baseContext.route,
      journey: step.startsWith("checkout") || step === "payment_submission"
        ? "checkout"
        : "bag",
      step,
      error,
      context,
      track,
    }).catch(() => undefined);
  };

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
    onError: () => {
      setOperationSuccessful(false);
    },
  });

  const updateSavedBagItemMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) =>
      updateSavedBagItem({
        savedBagId: savedBag!._id,
        quantity,
        itemId,
      }),
    onSuccess: () => {
      setOperationSuccessful(true);
      queryClient.invalidateQueries({
        queryKey: bagQueries.activeSavedBagKey(),
      });
    },
    onError: () => {
      setOperationSuccessful(false);
    },
  });

  const removeSavedBagItemMutation = useMutation({
    mutationFn: ({ itemId }: { itemId: string }) =>
      removeItemFromSavedBag({
        savedBagId: savedBag!._id,
        itemId: itemId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: bagQueries.activeSavedBagKey(),
      });
    },
    onError: () => {
      setOperationSuccessful(false);
    },
  });

  const updateSavedBag = async ({
    itemId,
    quantity,
  }: {
    itemId: string;
    quantity: number;
  }) => {
    setAction("adding-to-saved-bag");
    if (quantity == 0) return await deleteItemFromSavedBag(itemId);

    setOperationSuccessful(null);

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
    setOperationSuccessful(null);
    await addNewSavedBagItemMutation.mutateAsync({
      productId,
      quantity,
      productSkuId,
      productSku,
    });
    setOperationSuccessful(true);
  };

  const deleteItemFromSavedBag = async (itemId: string) => {
    setAction("deleting-from-saved-bag");
    await removeSavedBagItemMutation.mutateAsync({ itemId });
  };

  const savedBagCount =
    savedBag?.items?.reduce(
      (total: number, item: BagItem) => total + item.quantity,
      0
    ) || 0;

  const isUpdatingSavedBag =
    addNewSavedBagItemMutation.isPending ||
    updateSavedBagItemMutation.isPending ||
    removeSavedBagItemMutation.isPending;

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
    onError: (error, variables) => {
      setOperationSuccessful(false);
      reportFailure({
        step: "bag_item_addition",
        error,
        context: variables,
      });
    },
  });

  const updateBagItemMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) =>
      updateBagItem({
        bagId: bag!._id,
        quantity,
        itemId,
      }),
    onSuccess: () => {
      setOperationSuccessful(true);
      queryClient.invalidateQueries({ queryKey: bagQueries.activeBagKey() });
    },
    onError: (error, variables) => {
      setOperationSuccessful(false);
      reportFailure({
        step: "bag_item_update",
        error,
        context: variables,
      });
    },
  });

  const removeBagItem = useMutation({
    mutationFn: ({ itemId }: { itemId: string }) =>
      removeItemFromBag({
        bagId: bag!._id,
        itemId: itemId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bagQueries.activeBagKey() });
    },
    onError: (error, variables) => {
      setOperationSuccessful(false);
      reportFailure({
        step: "bag_item_removal",
        error,
        context: variables,
      });
    },
  });

  const clearBagMutation = useMutation({
    mutationFn: () =>
      clearBag({
        bagId: bag!._id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: bagQueries.activeBagKey(),
      });
    },
    onError: (error) => {
      setOperationSuccessful(false);
      reportFailure({
        step: "bag_clear",
        error,
        context: {
          bagId: bag?._id,
        },
      });
    },
  });

  const updateBag = async ({
    itemId,
    quantity,
  }: {
    itemId: string;
    quantity: number;
  }) => {
    setAction("adding-to-bag");
    if (quantity == 0) return await deleteItemFromBag(itemId);

    setOperationSuccessful(null);

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
    setOperationSuccessful(null);
    await addNewBagItem.mutateAsync({
      productId,
      quantity,
      productSkuId,
      productSku,
    });
  };

  const deleteItemFromBag = async (itemId: string) => {
    const remainingItems =
      bag?.items.filter((item) => item._id !== itemId) || [];

    const willHaveOneItemLeft = remainingItems.length === 1;

    if (!willHaveOneItemLeft) {
      setAction("deleting-from-bag");
      await removeBagItem.mutateAsync({ itemId });
      return;
    }

    const lastItem = remainingItems[0];
    const isLastItemDiscounted = promoCodeItems?.some(
      (sku: PromoCodeItem) => sku.productSku?._id === lastItem.productSkuId
    );

    if (isLastItemDiscounted) {
      await clearBagItems();
    } else {
      setAction("deleting-from-bag");
      await removeBagItem.mutateAsync({ itemId });
    }
  };

  const clearBagItems = async () => {
    setAction("deleting-from-bag");
    await clearBagMutation.mutateAsync();
  };

  const bagCount =
    bag?.items?.reduce(
      (total: number, item: BagItem) => total + item.quantity,
      0
    ) || 0;

  const bagSubtotal =
    bag?.items?.reduce(
      (sum: number, item: BagItem) => sum + (item.price || 0) * item.quantity,
      0
    ) || 0;

  const isUpdatingBag =
    addNewBagItem.isPending ||
    updateBagItemMutation.isPending ||
    removeBagItem.isPending;

  const moveItemFromBagToSaved = async (item: BagItem) => {
    await addProductToSavedBag({
      quantity: item.quantity,
      productId: item.productId,
      productSku: item.productSku,
      productSkuId: item.productSkuId,
    });

    await deleteItemFromBag(item._id);
  };

  const moveItemFromSavedToBag = async (item: SavedBagItem) => {
    await addProductToBag({
      quantity: item.quantity,
      productId: item.productId,
      productSku: item.productSku,
      productSkuId: item.productSkuId,
    });

    await deleteItemFromSavedBag(item._id);
  };

  const obtainCheckoutSessionMutation = useMutation({
    mutationFn: ({ bagId }: { bagId: string }) =>
      createCheckoutSession({
        bagId,
      }),
    onError: (error, variables) => {
      setOperationSuccessful(false);
      reportFailure({
        step: "checkout_session_creation",
        error,
        context: variables,
      });
    },
    onSuccess: (res) => {
      setOperationSuccessful(true);
      if (isUnavailableProductList(res.unavailableProducts)) {
        setUnavailableProducts(res.unavailableProducts);
      } else {
        setUnavailableProducts([]);
      }
    },
  });

  const updateCheckoutSessionMutation = useMutation({
    mutationFn: ({
      sessionId,
      isFinalizingPayment,
      customerEmail,
      orderDetails,
      action = "finalize-payment",
    }: {
      isFinalizingPayment?: boolean;
      sessionId: string;
      customerEmail: string;
      orderDetails: CheckoutOrderSubmission;
      action?: "finalize-payment" | "create-pod-order";
    }) =>
      updateCheckoutSessionAPI({
        isFinalizingPayment,
        sessionId,
        customerEmail,
        action,
        orderDetails,
      }),
    onError: (error, variables) => {
      setOperationSuccessful(false);
      reportFailure({
        step: "payment_submission",
        error,
        context: {
          sessionId: variables.sessionId,
          customerEmail: variables.customerEmail,
          checkoutAction: variables.action,
        },
      });
    },
    onSuccess: () => {
      setOperationSuccessful(true);
    },
  });

  const areProductsUnavailable = unavailableProducts.some(
    (p) => p.available == 0
  );

  const obtainCheckoutSession = async ({
    bagId,
  }: {
    bagId: string;
  }) => {
    setOperationSuccessful(null);
    return await obtainCheckoutSessionMutation.mutateAsync({
      bagId,
    });
  };

  const updateCheckoutSession = async ({
    isFinalizingPayment,
    sessionId,
    customerEmail,
    orderDetails,
    action = "finalize-payment",
  }: {
    isFinalizingPayment?: boolean;
    sessionId: string;
    customerEmail: string;
    orderDetails: CheckoutOrderSubmission;
    action?: "finalize-payment" | "create-pod-order";
  }) => {
    setOperationSuccessful(null);

    return await updateCheckoutSessionMutation.mutateAsync({
      isFinalizingPayment,
      sessionId,
      customerEmail,
      orderDetails,
      action,
    });
  };

  return {
    bagAction: action,
    addProductToBag,
    bag,
    bagCount,
    bagSubtotal,
    clearBagItems,
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
    operationSuccessful,
    obtainCheckoutSession,
    unavailableProducts,
    areProductsUnavailable,
    updateCheckoutSession,
  };
};
const isUnavailableProductList = (
  value: unknown,
): value is UnavailableProducts => {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item?.productSkuId === "string" &&
        typeof item?.requested === "number" &&
        typeof item?.available === "number",
    )
  );
};
