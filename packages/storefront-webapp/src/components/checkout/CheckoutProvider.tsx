import React, { createContext, useEffect, useState } from "react";
import { ZodError } from "zod";
import { useGetActiveCheckoutSession } from "@/hooks/useGetActiveCheckoutSession";
import {
  CheckoutExpired,
  NoCheckoutSession,
} from "../states/checkout-expired/CheckoutExpired";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { useStoreContext } from "@/contexts/StoreContext";
import { CheckoutUnavailable } from "../states/checkout unavailable/CheckoutUnavailable";
import { useNavigationBarContext } from "@/contexts/NavigationBarProvider";
import { isFeeWaived, isAnyFeeWaived } from "@/lib/feeUtils";

import { useOnlineOrderQueries } from "@/lib/queries/onlineOrder";
import { useQuery } from "@tanstack/react-query";
import { CheckoutState, CheckoutActions, CheckoutContextType } from "./types";
import { getStoreConfigV2, isStoreReadOnlyMode } from "@/lib/storeConfig";
import { webOrderSchema } from "./schemas/webOrderSchema";
import { calculateDeliveryFee } from "./deliveryFees";
import { deriveCheckoutState } from "./deriveCheckoutState";
import { loadCheckoutState, saveCheckoutState } from "./checkoutStorage";

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
  const [checkoutState, setCheckoutState] = useState<CheckoutState>(() =>
    loadCheckoutState(initialState),
  );

  const [actionsState, setActionsState] =
    useState<CheckoutActions>(initialActionsState);

  const { bag, bagSubtotal } = useShoppingBag();
  const subtotalInPesewas = bagSubtotal;

  const { user, store } = useStoreContext();
  const storeConfig = getStoreConfigV2(store);

  const { setNavBarLayout, setAppLocation } = useNavigationBarContext();

  const { waiveDeliveryFees, fulfillment, deliveryFees } = storeConfig.commerce;
  // Default to true if not set (for backward compatibility)
  const isPickupEnabled = fulfillment?.enableStorePickup ?? true;
  const isDeliveryEnabled = fulfillment?.enableDelivery ?? true;

  // Helper function to check if restriction is within time window
  const isWithinRestrictionTime = (restriction: any): boolean => {
    if (!restriction?.isActive) return false;

    const now = Date.now();
    const { startTime, endTime } = restriction;

    // If no times set, restriction is always active
    if (!startTime && !endTime) return true;

    // Check if within time window
    if (startTime && now < startTime) return false;
    if (endTime && now > endTime) return false;

    return true;
  };

  // Check for temporary restrictions
  const pickupRestriction = fulfillment?.pickupRestriction;
  const deliveryRestriction = fulfillment?.deliveryRestriction;

  const isPickupRestricted =
    pickupRestriction?.isActive && isWithinRestrictionTime(pickupRestriction);
  const isDeliveryRestricted =
    deliveryRestriction?.isActive &&
    isWithinRestrictionTime(deliveryRestriction);

  const pickupAvailable = isPickupEnabled && !isPickupRestricted;
  const deliveryAvailable = isDeliveryEnabled && !isDeliveryRestricted;

  useEffect(() => {
    setNavBarLayout("fixed");
    setAppLocation("checkout");
  }, []);

  // Auto-switch to delivery if pickup is disabled/restricted and currently selected
  useEffect(() => {
    if (!pickupAvailable && checkoutState.deliveryMethod === "pickup") {
      if (deliveryAvailable) {
        updateState({
          deliveryMethod: "delivery",
          deliveryOption: null,
          deliveryFee: null,
          pickupLocation: null,
        });
      }
    }
  }, [pickupAvailable, deliveryAvailable]);

  // Auto-switch to pickup if delivery is disabled/restricted and currently selected
  useEffect(() => {
    if (!deliveryAvailable && checkoutState.deliveryMethod === "delivery") {
      if (pickupAvailable) {
        updateState({
          deliveryMethod: "pickup",
          deliveryOption: null,
          deliveryFee: 0,
          paymentMethod: "online_payment",
          pickupLocation: "wigclub-hair-studio",
          podPaymentMethod: null,
        });
      }
    }
  }, [pickupAvailable, deliveryAvailable]);

  useEffect(() => {
    if (bag?.items?.length && bag?.items?.length > 0) {
      saveCheckoutState({ ...checkoutState, bag });
    }
  }, [checkoutState, bag]);

  useEffect(() => {
    if (bag?.items?.length && bag?.items?.length > 0) {
      setCheckoutState((prev) => ({
        ...prev,
        discount: null,
        bag,
      }));
    }
  }, [bag]);

  const areFeesWaived = isAnyFeeWaived(waiveDeliveryFees, subtotalInPesewas);

  const isFeeWaivedForCurrentOption = isFeeWaived(
    waiveDeliveryFees,
    checkoutState.deliveryOption,
    subtotalInPesewas,
  );

  // If the delivery fee is 0 and the fees are not waived, recalculate the delivery fee
  useEffect(() => {
    if (
      checkoutState.deliveryMethod === "delivery" &&
      checkoutState.deliveryFee === 0 &&
      !areFeesWaived
    ) {
      let deliveryFee = deliveryFees.withinAccra;

      if (checkoutState.deliveryOption === "outside-accra") {
        deliveryFee = deliveryFees.otherRegions;
      } else if (checkoutState.deliveryOption === "intl") {
        deliveryFee = deliveryFees.international;
      } else {
        deliveryFee = deliveryFees.withinAccra;
      }

      updateState({ deliveryFee });
    } else if (
      checkoutState.deliveryMethod === "delivery" &&
      isFeeWaivedForCurrentOption &&
      checkoutState.deliveryFee != 0
    ) {
      updateState({ deliveryFee: 0 });
    }
  }, [checkoutState, deliveryFees, areFeesWaived, isFeeWaivedForCurrentOption]);

  useEffect(() => {
    if (user) {
      const { shippingAddress, billingAddress } = user;

      if (!shippingAddress || !billingAddress) return;

      const { address, city, zip, state, country, region } =
        shippingAddress || {};

      const {
        address: billingAddr,
        city: billingCity,
        zip: billingZip,
        state: billingState,
        country: billingCountry,
        region: billingRegion,
      } = billingAddress || {};

      const { email, firstName, lastName, phoneNumber } = user;

      const { deliveryFee, deliveryOption } = calculateDeliveryFee({
        deliveryMethod: "delivery",
        country: country || "",
        region: region || null,
        waiveDeliveryFees,
        deliveryFees,
        subtotal: subtotalInPesewas,
      });

      updateState({
        customerDetails: {
          email,
          firstName: firstName || "",
          lastName: lastName || "",
          phoneNumber: phoneNumber || "",
        },
        deliveryMethod: shippingAddress ? "delivery" : null,
        deliveryOption,
        deliveryFee,
        deliveryDetails: {
          address,
          city,
          zip,
          state,
          country,
          region,
        },
        billingDetails: {
          address: billingAddr,
          city: billingCity,
          zip: billingZip,
          state: billingState,
          country: billingCountry,
          region: billingRegion,
        },
      });
    }
  }, [user]);

  const updateState = (updates: Partial<CheckoutState>) => {
    const anyFeeWaived = isAnyFeeWaived(waiveDeliveryFees, subtotalInPesewas);

    // Prevent setting deliveryMethod to pickup when it's unavailable
    if (!pickupAvailable && updates.deliveryMethod === "pickup") {
      console.warn(
        "Store pickup is currently unavailable. Cannot set delivery method to pickup.",
      );
      return;
    }

    // Prevent setting deliveryMethod to delivery when it's unavailable
    if (!deliveryAvailable && updates.deliveryMethod === "delivery") {
      console.warn(
        "Delivery is currently unavailable. Cannot set delivery method to delivery.",
      );
      return;
    }

    if (
      anyFeeWaived &&
      updates.deliveryMethod === "delivery" &&
      (updates.deliveryFee === null || updates.deliveryFee === undefined)
    ) {
      updates.deliveryFee = 0;
    }

    setCheckoutState((prev) => {
      const newUpdates = { ...prev, ...updates };

      const isDeliveryOrder = newUpdates.deliveryMethod == "delivery";

      // Always set international delivery for non-Ghana countries
      if (
        isDeliveryOrder &&
        newUpdates.deliveryDetails?.country &&
        newUpdates.deliveryDetails.country !== "GH" &&
        newUpdates.deliveryOption !== "intl"
      ) {
        const shouldWaiveIntlFee = isFeeWaived(
          waiveDeliveryFees,
          "intl",
          subtotalInPesewas,
        );

        newUpdates.deliveryOption = "intl";
        newUpdates.deliveryFee = shouldWaiveIntlFee
          ? 0
          : deliveryFees?.international || 80000;
      }

      return deriveCheckoutState(newUpdates);
    });
  };

  const updateActionsState = (actions: Partial<CheckoutActions>) => {
    setActionsState((prev) => ({ ...prev, ...actions }));
  };

  const canPlaceOrder = async () => {
    const { data } = await refetch();

    if (data == null) {
      return false;
    }

    // Ensure deliveryFee is set to 0 when waiveDeliveryFees is true and delivery method is 'delivery'
    if (
      waiveDeliveryFees &&
      checkoutState.deliveryMethod === "delivery" &&
      checkoutState.deliveryFee === null
    ) {
      updateState({ deliveryFee: 0 });
    }

    try {
      // Parse the state using the schema
      webOrderSchema.parse(checkoutState);
      updateState({ failedFinalValidation: false });

      return true;
    } catch (e) {
      console.log((e as ZodError).flatten());
      updateState({ failedFinalValidation: true });
      return false;
    }
  };

  const { data, isLoading, refetch } = useGetActiveCheckoutSession();

  const onlineOrderQueries = useOnlineOrderQueries();
  const { data: onlineOrder } = useQuery(
    onlineOrderQueries.detail(data?.placedOrderId || ""),
  );

  console.log("online order", onlineOrder);

  // Sync discount from session to checkout state
  useEffect(() => {
    if (actionsState.isApplyingDiscount) {
      return;
    }

    const discount = data?.discount || (data as any)?.session?.discount;
    if (discount && !checkoutState.discount) {
      updateState({
        discount: {
          id: discount.promoCodeId || discount._id || discount.id,
          code: discount.code,
          value: discount.value ?? discount.discountValue,
          type: discount.type ?? discount.discountType,
          span: discount.span,
          productSkus: discount.productSkus,
          totalDiscount: discount.totalDiscount,
          isMultipleUses: discount.isMultipleUses,
          autoApply: discount.autoApply,
        },
      });
    } else if (!discount && checkoutState.discount?.autoApply === true) {
      updateState({
        discount: null,
      });
    }
  }, [data, checkoutState.discount, actionsState.isApplyingDiscount]);

  if (isStoreReadOnlyMode(store)) {
    return <CheckoutUnavailable />;
  }

  if (isLoading || data === undefined) return null;

  const hasServerBackedCheckout =
    Boolean(data?.placedOrderId) ||
    Boolean(data?.hasCompletedPayment) ||
    Boolean(data?.hasVerifiedPayment);

  if (checkoutState.bag === null && !hasServerBackedCheckout) {
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
