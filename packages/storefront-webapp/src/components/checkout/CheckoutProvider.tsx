import React, { createContext, useEffect, useState } from "react";
import { useGetActiveCheckoutSession } from "@/hooks/useGetActiveCheckoutSession";
import {
  CheckoutExpired,
  NoCheckoutSession,
} from "../states/checkout-expired/CheckoutExpired";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { useStoreContext } from "@/contexts/StoreContext";
import { SESSION_STORAGE_KEY } from "@/lib/constants";
import { CheckoutUnavailable } from "../states/checkout unavailable/CheckoutUnavailable";
import { useNavigationBarContext } from "@/contexts/NavigationBarProvider";
import { isAnyFeeWaived } from "@/lib/feeUtils";
import { useOnlineOrderQueries } from "@/lib/queries/onlineOrder";
import { useQuery } from "@tanstack/react-query";
import {
  CheckoutState,
  CheckoutActions,
  CheckoutContextType,
} from "./types";
import { deriveCheckoutState } from "./deriveCheckoutState";
import { useCheckoutPersistence } from "./hooks/useCheckoutPersistence";
import {
  computeFulfillmentAvailability,
  useFulfillmentAvailability,
} from "./hooks/useFulfillmentAvailability";
import { useUserDataPrefill } from "./hooks/useUserDataPrefill";
import { useDiscountSync } from "./hooks/useDiscountSync";

export { webOrderSchema } from "./schemas/webOrderSchema";

const initialActionsState: CheckoutActions = {
  isEditingCustomerDetails: false,
  isEditingDeliveryDetails: false,
  isEditingBillingDetails: false,

  didEnterDeliveryDetails: false,
  didEnterBillingDetails: false,

  didToggleOrderSummary: false,
  isApplyingDiscount: false,
};

const initialState: CheckoutState = {
  billingDetails: null,
  deliveryFee: null,
  deliveryMethod: "pickup",
  deliveryOption: null,
  deliveryDetails: null,
  deliveryInstructions: "",
  customerDetails: null,
  pickupLocation: "wigclub-hair-studio",

  didEnterDeliveryDetails: false,
  didEnterBillingDetails: false,
  didSelectPickupLocation: false,

  isUSOrder: false,
  isROWOrder: false,
  isGhanaOrder: true,
  isPickupOrder: true,
  isDeliveryOrder: false,

  failedFinalValidation: false,
  bag: null,
  discount: null,
  onlineOrder: null,

  // Payment method defaults
  paymentMethod: "online_payment",
  podPaymentMethod: null,
};

export const CheckoutContext = createContext<CheckoutContextType | null>(null);

export const defaultRegion = new Intl.Locale(navigator.language).region || "GH";

export const CheckoutProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [checkoutState, setCheckoutState] = useState<CheckoutState>(() => {
    if (typeof window === "undefined") return initialState;

    try {
      const savedState = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (savedState) {
        const parsed = JSON.parse(savedState);
        return {
          ...initialState,
          ...parsed,
          paymentMethod: parsed.paymentMethod || "online_payment",
          podPaymentMethod: parsed.podPaymentMethod || null,
        };
      }
      return initialState;
    } catch {
      return initialState;
    }
  });

  const [actionsState, setActionsState] =
    useState<CheckoutActions>(initialActionsState);

  const { bag } = useShoppingBag();
  const { user, store } = useStoreContext();
  const { setNavBarLayout, setAppLocation } = useNavigationBarContext();

  const { waiveDeliveryFees } = store?.config || {};
  const deliveryFees = store?.config?.deliveryFees;

  // Compute availability before updateState so the guard can reference these values
  const { pickupAvailable, deliveryAvailable } =
    computeFulfillmentAvailability(store);

  useEffect(() => {
    setNavBarLayout("fixed");
    setAppLocation("checkout");
  }, []);

  const updateState = (updates: Partial<CheckoutState>) => {
    const anyFeeWaived = isAnyFeeWaived(waiveDeliveryFees);

    if (!pickupAvailable && updates.deliveryMethod === "pickup") {
      return;
    }

    if (!deliveryAvailable && updates.deliveryMethod === "delivery") {
      return;
    }

    if (
      anyFeeWaived &&
      updates.deliveryMethod === "delivery" &&
      (updates.deliveryFee === null || updates.deliveryFee === undefined)
    ) {
      updates.deliveryFee = 0;
    }

    setCheckoutState((prev) =>
      deriveCheckoutState(prev, updates, { waiveDeliveryFees, deliveryFees })
    );
  };

  useFulfillmentAvailability(
    pickupAvailable,
    deliveryAvailable,
    checkoutState,
    updateState
  );

  useCheckoutPersistence(checkoutState, bag, setCheckoutState);
  useUserDataPrefill(user, store, updateState);

  const { data, isLoading, refetch } = useGetActiveCheckoutSession();
  useDiscountSync(data, checkoutState, actionsState, updateState);

  const onlineOrderQueries = useOnlineOrderQueries();
  const { data: onlineOrder } = useQuery(
    onlineOrderQueries.detail(data?.placedOrderId || "")
  );

  const updateActionsState = (actions: Partial<CheckoutActions>) => {
    setActionsState((prev) => ({ ...prev, ...actions }));
  };

  const canPlaceOrder = async () => {
    const { data: sessionData } = await refetch();

    if (sessionData == null) {
      return false;
    }

    if (
      waiveDeliveryFees &&
      checkoutState.deliveryMethod === "delivery" &&
      checkoutState.deliveryFee === null
    ) {
      updateState({ deliveryFee: 0 });
    }

    try {
      const { webOrderSchema } = await import("./schemas/webOrderSchema");
      webOrderSchema.parse(checkoutState);
      updateState({ failedFinalValidation: false });
      return true;
    } catch {
      updateState({ failedFinalValidation: true });
      return false;
    }
  };

  const { config } = store || {};

  if (config?.visibility?.inReadOnlyMode) {
    return <CheckoutUnavailable />;
  }

  if (isLoading || data === undefined) return null;

  if (checkoutState.bag === null) {
    return <NoCheckoutSession />;
  }

  if (data === null) {
    return <CheckoutExpired />;
  }

  return (
    <CheckoutContext.Provider
      value={{
        actionsState,
        checkoutState,
        canPlaceOrder,
        updateState,
        updateActionsState,
        activeSession: data,
        onlineOrder: onlineOrder || null,
      }}
    >
      {children}
    </CheckoutContext.Provider>
  );
};
