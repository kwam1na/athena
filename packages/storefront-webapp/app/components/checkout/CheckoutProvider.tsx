import React, { createContext, useContext, useEffect, useState } from "react";
import { z, ZodError } from "zod";
import { customerDetailsSchema } from "./CustomerDetails";
import { billingDetailsSchema } from "./BillingDetails";
import { deliveryDetailsSchema } from "./DeliveryDetails/schema";
import { useGetActiveCheckoutSession } from "@/hooks/useGetActiveCheckoutSession";
import { CheckoutExpired } from "../states/checkout-expired/CheckoutExpired";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { checkoutSessionQueries } from "@/queries";
import { useStoreContext } from "@/contexts/StoreContext";

export type Address = {
  address: string;
  city: string;
  state?: string;
  zip?: string;
  country: string;
  region?: string;
};

type BillingAddress = Address & { billingAddressSameAsDelivery?: boolean };

export type CustomerDetails = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
};

export const webOrderSchema = z
  .object({
    billingDetails: billingDetailsSchema,
    customerDetails: customerDetailsSchema,
    deliveryMethod: z
      .enum(["pickup", "delivery"])
      .refine((value) => !!value, { message: "Delivery method is required" }),
    deliveryOption: z
      .enum(["within-accra", "outside-accra", "intl"])
      .refine((value) => !!value, { message: "Delivery option is required" })
      .nullable(),
    deliveryFee: z.number().nullable(),
    pickupLocation: z.string().min(1).nullable(),
    deliveryDetails: deliveryDetailsSchema.nullable(),
  })
  .superRefine((data, ctx) => {
    const { deliveryMethod, deliveryDetails } = data;

    if (deliveryMethod == "delivery") {
      if (!deliveryDetails) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deliveryDetails"],
          message: "Delivery details are required",
        });
      }

      const { address, city, state, zip, region, country } =
        deliveryDetails || {};

      if (!address) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deliveryDetails", "address"],
          message: "Address is required",
        });
      }

      if (address?.trim().length == 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deliveryDetails", "address"],
          message: "Address cannot be empty or whitespace",
        });
      }

      if (!city) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deliveryDetails", "city"],
          message: "City is required",
        });
      }

      if (city?.trim().length == 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deliveryDetails", "city"],
          message: "City cannot be empty or whitespace",
        });
      }

      if (!country) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deliveryDetails", "country"],
          message: "Country is required",
        });
      }

      if (country == "US") {
        if (!state) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "state"],
            message: "State is required",
          });
        }

        if (!zip) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "zip"],
            message: "Zip is required",
          });
        }

        if (zip?.trim().length == 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["zip"],
            message: "Zip code cannot be empty or whitespace",
          });
        }

        if (zip && !/^\d{5}$/.test(zip)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["zip"],
            message: "Zip code must be a 5-digit number",
          });
        }
      }

      if (country == "GH") {
        if (!region) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["region"],
            message: "Region is required",
          });
        }
      }
    }
  });

type CheckoutState = {
  billingDetails: BillingAddress | null;
  customerDetails: CustomerDetails | null;
  deliveryMethod: "delivery" | "pickup" | null;
  deliveryOption: "within-accra" | "outside-accra" | "intl" | null;
  deliveryFee: number | null;
  deliveryDetails: Address | null;
  pickupLocation: string | null;

  didEnterDeliveryDetails: boolean;
  didSelectPickupLocation: boolean;
  didEnterBillingDetails: boolean;

  isUSOrder: boolean;
  isGhanaOrder: boolean;
  isROWOrder: boolean;
  isPickupOrder: boolean;
  isDeliveryOrder: boolean;

  failedFinalValidation: boolean;

  bag: any;
};

type CheckoutActions = {
  isEditingCustomerDetails: boolean;
  isEditingDeliveryDetails: boolean;
  isEditingBillingDetails: boolean;

  didEnterDeliveryDetails: boolean;
  didEnterBillingDetails: boolean;
};

const initialActionsState: CheckoutActions = {
  isEditingCustomerDetails: false,
  isEditingDeliveryDetails: false,
  isEditingBillingDetails: false,

  didEnterDeliveryDetails: false,
  didEnterBillingDetails: false,
};

const initialState: CheckoutState = {
  billingDetails: null,
  deliveryFee: null,
  deliveryMethod: null,
  deliveryOption: null,
  deliveryDetails: null,
  customerDetails: null,
  pickupLocation: null,

  didEnterDeliveryDetails: false,
  didEnterBillingDetails: false,
  didSelectPickupLocation: false,

  isUSOrder: false,
  isGhanaOrder: false,
  isROWOrder: false,
  isPickupOrder: false,
  isDeliveryOrder: false,

  failedFinalValidation: false,
  bag: null,
};

type CheckoutContextType = {
  activeSession: any;
  actionsState: CheckoutActions;
  checkoutState: CheckoutState;
  canPlaceOrder: () => Promise<boolean>;
  updateState: (newState: Partial<CheckoutState>) => void;
  updateActionsState: (newState: Partial<CheckoutActions>) => void;
};

const CheckoutContext = createContext<CheckoutContextType | null>(null);

export const useCheckout = () => {
  const context = useContext(CheckoutContext);
  if (!context) {
    throw new Error("useCheckout must be used within a CheckoutProvider");
  }
  return context;
};

export const defaultRegion = new Intl.Locale(navigator.language).region || "GH";

export const CheckoutProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const SESSION_STORAGE_KEY = "checkoutState";

  // Load initial state from sessionStorage or fallback to the default state
  const [checkoutState, setCheckoutState] = useState<CheckoutState>(() => {
    const savedState = sessionStorage.getItem(SESSION_STORAGE_KEY);
    return savedState ? JSON.parse(savedState) : initialState;
  });

  const [actionsState, setActionsState] = useState(initialActionsState);

  const { bag } = useShoppingBag();

  useEffect(() => {
    // Save the current state to sessionStorage whenever it changes and bag is not empty
    if (bag?.items.length > 0) {
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ ...checkoutState, bag })
      );
    }
  }, [checkoutState, bag]);

  useEffect(() => {
    if (bag?.items.length > 0) {
      setCheckoutState((prev) => ({
        ...prev,
        bag,
      }));
    }
  }, [bag]);

  useEffect(() => {
    const determineRegion = () => {
      try {
        const region = new Intl.Locale(navigator.language).region || "GH";
        setCheckoutState((prev) => ({
          ...prev,
        }));
      } catch {
        setCheckoutState((prev) => ({
          ...prev,
        }));
      }
    };

    determineRegion();
  }, []);

  const updateState = (updates: Partial<CheckoutState>) => {
    setCheckoutState((prev) => {
      const newUpdates = { ...prev, ...updates };

      const isDeliveryOrder = newUpdates.deliveryMethod == "delivery";

      const isPickupOrder = newUpdates.deliveryMethod == "pickup";

      const isUSOrder =
        isDeliveryOrder && newUpdates.deliveryDetails?.country == "US";

      const isGhanaOrder =
        isPickupOrder ||
        (isDeliveryOrder && newUpdates.deliveryDetails?.country == "GH");

      const isROWOrder = isDeliveryOrder && !isUSOrder && !isGhanaOrder;

      const didSelectPickupLocation = Boolean(
        isPickupOrder && newUpdates.pickupLocation
      );

      const didProvideAllUSAddressFields = Boolean(
        newUpdates.deliveryDetails?.address &&
          newUpdates.deliveryDetails?.city &&
          newUpdates.deliveryDetails?.state &&
          newUpdates.deliveryDetails?.zip
      );

      const didProvideAllRestOfWorldFields = Boolean(
        newUpdates.deliveryDetails?.address && newUpdates.deliveryDetails?.city
      );

      const didProvideAllGhanaAddressFields = Boolean(
        newUpdates.deliveryDetails?.address &&
          newUpdates.deliveryDetails?.city &&
          newUpdates.deliveryDetails?.region
      );

      const didEnterDeliveryDetails =
        (isUSOrder
          ? didProvideAllUSAddressFields
          : isGhanaOrder && isDeliveryOrder
            ? didProvideAllGhanaAddressFields
            : didProvideAllRestOfWorldFields) &&
        Boolean(newUpdates.deliveryOption);

      const didProvideAllUSBillingAddressFields = Boolean(
        newUpdates.billingDetails?.address &&
          newUpdates.billingDetails?.city &&
          newUpdates.billingDetails?.state &&
          newUpdates.billingDetails?.zip
      );

      const didProvideAllRestOfWorldBillingFields = Boolean(
        newUpdates.billingDetails?.address && newUpdates.billingDetails?.city
      );

      const didProvideAllGhanaBillingAddressFields = Boolean(
        newUpdates.billingDetails?.address && newUpdates.billingDetails?.city
      );

      const isGhanaBillingAddrss = newUpdates.billingDetails?.country == "GH";
      const isUSBillingAddrss = newUpdates.billingDetails?.country == "US";

      const didEnterBillingDetails = isGhanaBillingAddrss
        ? didProvideAllGhanaBillingAddressFields
        : isUSBillingAddrss
          ? didProvideAllUSBillingAddressFields
          : didProvideAllRestOfWorldBillingFields;

      return {
        ...newUpdates,
        didEnterDeliveryDetails,
        didEnterBillingDetails,
        didSelectPickupLocation,
        isGhanaOrder,
        isUSOrder,
        isROWOrder,
        isPickupOrder,
        isDeliveryOrder,
      };
    });
  };

  const updateActionsState = (actions: Partial<CheckoutActions>) => {
    setActionsState((prev) => ({ ...prev, ...actions }));
  };

  const canPlaceOrder = async () => {
    const { data } = await refetch();

    if (data?.message?.includes("No active session found")) {
      return false;
    }

    try {
      // Parse the state using the schema
      webOrderSchema.parse(checkoutState);
      updateState({ failedFinalValidation: false });

      return true;
    } catch (e) {
      console.log((e as ZodError).errors);
      updateState({ failedFinalValidation: true });
      return false;
    }
  };

  const { data, isLoading, refetch } = useGetActiveCheckoutSession();

  if (isLoading || !data) return null;

  // console.log("checkout session ->", data);

  if (data?.message?.includes("No active session found")) {
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
        activeSession: data?.session,
      }}
    >
      {children}
    </CheckoutContext.Provider>
  );
};
