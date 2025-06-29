import React, { createContext, useContext, useEffect, useState } from "react";
import { z, ZodError } from "zod";
import { useGetActiveCheckoutSession } from "@/hooks/useGetActiveCheckoutSession";
import {
  CheckoutExpired,
  NoCheckoutSession,
} from "../states/checkout-expired/CheckoutExpired";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { useStoreContext } from "@/contexts/StoreContext";
import { SESSION_STORAGE_KEY } from "@/lib/constants";
import { customerDetailsSchema } from "./schemas/customerDetailsSchema";
import { baseDeliveryDetailsSchema } from "./schemas/deliveryDetailsSchema";
import { baseBillingDetailsSchema } from "./schemas/billingDetailsSchema";
import { CheckoutSession } from "@athena/webapp";
import { CheckoutUnavailable } from "../states/checkout unavailable/CheckoutUnavailable";
import { useNavigationBarContext } from "@/contexts/NavigationBarProvider";
import { isFeeWaived, isAnyFeeWaived } from "@/lib/feeUtils";

export type Address = {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country: string;
  region?: string;
  street?: string;
  houseNumber?: string;
  neighborhood?: string;
  landmark?: string;
};

export type BillingAddress = Address & {
  billingAddressSameAsDelivery?: boolean;
};

export type CustomerDetails = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
};

export const webOrderSchema = z
  .object({
    // billingDetails: baseBillingDetailsSchema,
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
    deliveryDetails: baseDeliveryDetailsSchema.optional().nullable(),
    deliveryInstructions: z.string().optional(),
    discount: z.record(z.string(), z.any()).nullable(),
  })
  .superRefine((data, ctx) => {
    const { deliveryFee, deliveryMethod, deliveryDetails, pickupLocation } =
      data;

    if (deliveryMethod == "delivery") {
      // if (!billingDetails) {
      //   ctx.addIssue({
      //     code: z.ZodIssueCode.custom,
      //     path: ["billingDetails"],
      //     message: "Billing details are required",
      //   });
      // }

      // const {
      //   address: billingAddress,
      //   billingAddressSameAsDelivery,
      //   city: billingCity,
      //   state: billingState,
      //   zip: billingZip,
      //   country: billingCountry,
      // } = billingDetails || {};

      // const isUSBillingAddress = billingCountry == "US";

      // if (!billingAddressSameAsDelivery) {
      //   if (!billingAddress) {
      //     ctx.addIssue({
      //       code: z.ZodIssueCode.custom,
      //       path: ["billingDetails", "address"],
      //       message: "Address is required",
      //     });
      //   }

      //   if (billingAddress?.trim().length == 0) {
      //     ctx.addIssue({
      //       code: z.ZodIssueCode.custom,
      //       path: ["billingDetails", "address"],
      //       message: "Address cannot be empty or whitespace",
      //     });
      //   }

      //   if (!billingCity) {
      //     ctx.addIssue({
      //       code: z.ZodIssueCode.custom,
      //       path: ["billingDetails", "city"],
      //       message: "City is required",
      //     });
      //   }

      //   if (billingCity?.trim().length == 0) {
      //     ctx.addIssue({
      //       code: z.ZodIssueCode.custom,
      //       path: ["billingDetails", "city"],
      //       message: "City cannot be empty or whitespace",
      //     });
      //   }

      //   if (!billingCountry) {
      //     ctx.addIssue({
      //       code: z.ZodIssueCode.custom,
      //       path: ["billingDetails", "country"],
      //       message: "Country is required",
      //     });
      //   }
      // }

      // if (billingCountry?.trim().length == 0) {
      //   ctx.addIssue({
      //     code: z.ZodIssueCode.custom,
      //     path: ["billingDetails", "country"],
      //     message: "Country cannot be empty or whitespace",
      //   });
      // }

      // if (isUSBillingAddress) {
      //   if (!billingState) {
      //     ctx.addIssue({
      //       code: z.ZodIssueCode.custom,
      //       path: ["billingDetails", "state"],
      //       message: "State is required",
      //     });

      //     if (billingState?.trim().length == 0) {
      //       ctx.addIssue({
      //         code: z.ZodIssueCode.custom,
      //         path: ["billingDetails", "state"],
      //         message: "State cannot be empty or whitespace",
      //       });
      //     }
      //   }

      //   if (!billingZip) {
      //     ctx.addIssue({
      //       code: z.ZodIssueCode.custom,
      //       path: ["billingDetails", "zip"],
      //       message: "Zip is required",
      //     });
      //   }

      //   if (billingZip?.trim().length == 0) {
      //     ctx.addIssue({
      //       code: z.ZodIssueCode.custom,
      //       path: ["billingDetails", "zip"],
      //       message: "Zip code cannot be empty or whitespace",
      //     });
      //   }

      //   if (billingZip && !/^\d{5}$/.test(billingZip)) {
      //     ctx.addIssue({
      //       code: z.ZodIssueCode.custom,
      //       path: ["billingDetails", "zip"],
      //       message: "Zip code must be a 5-digit number",
      //     });
      //   }
      // }

      if (deliveryFee == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deliveryFee"],
          message: "Delivery fee is required",
        });
      }

      if (!deliveryDetails) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deliveryDetails"],
          message: "Delivery details are required",
        });
      }

      const {
        address,
        city,
        street,
        neighborhood,
        state,
        zip,
        region,
        country,
      } = deliveryDetails || {};

      const isGhanaAddress = country == "GH";

      const isUSAddress = country == "US";

      // validate the address fields for US and ROW orders
      if (!isGhanaAddress) {
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
      }

      if (!country) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deliveryDetails", "country"],
          message: "Country is required",
        });
      }

      if (isUSAddress) {
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
            path: ["deliveryDetails", "zip"],
            message: "Zip code cannot be empty or whitespace",
          });
        }

        if (zip && !/^\d{5}$/.test(zip)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "zip"],
            message: "Zip code must be a 5-digit number",
          });
        }
      }

      if (isGhanaAddress) {
        if (!region) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "region"],
            message: "Region is required",
          });
        }

        if (!street) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "street"],
            message: "Street is required",
          });
        }

        // if (!houseNumber) {
        //   ctx.addIssue({
        //     code: z.ZodIssueCode.custom,
        //     path: ["deliveryDetails", "houseNumber"],
        //     message: "Apt/House number is required",
        //   });
        // }

        if (!neighborhood) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "neighborhood"],
            message: "Neighborhood is required",
          });
        }
      }
    }

    if (deliveryMethod == "pickup") {
      if (!pickupLocation) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pickupLocation"],
          message: "Pickup location is required",
        });
      }

      if (pickupLocation?.trim().length == 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pickupLocation"],
          message: "Pickup location cannot be empty or whitespace",
        });
      }
    }
  });

type DeliveryOption = "within-accra" | "outside-accra" | "intl";

export type DeliveryMethod = "delivery" | "pickup";

export type Discount = {
  id: string;
  code: string;
  type: "percentage" | "amount";
  value: number;
  span: "entire-order" | "selected-products";
  productSkus?: string[];
  totalDiscount?: number;
};

export type PaymentMethodType = "online_payment" | "payment_on_delivery";
export type PODPaymentMethod = "cash" | "mobile_money";

type CheckoutState = {
  billingDetails: BillingAddress | null;
  customerDetails: CustomerDetails | null;
  deliveryMethod: DeliveryMethod | null;
  deliveryOption: DeliveryOption | null;
  deliveryFee: number | null;
  deliveryDetails: Address | null;
  deliveryInstructions: string;
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

  discount: Discount | null;

  // Payment method fields
  paymentMethod: PaymentMethodType | null;
  podPaymentMethod: PODPaymentMethod | null;
};

type CheckoutActions = {
  isEditingCustomerDetails: boolean;
  isEditingDeliveryDetails: boolean;
  isEditingBillingDetails: boolean;

  didEnterDeliveryDetails: boolean;
  didEnterBillingDetails: boolean;

  didToggleOrderSummary: boolean;
};

const initialActionsState: CheckoutActions = {
  isEditingCustomerDetails: false,
  isEditingDeliveryDetails: false,
  isEditingBillingDetails: false,

  didEnterDeliveryDetails: false,
  didEnterBillingDetails: false,

  didToggleOrderSummary: false,
};

const initialState: CheckoutState = {
  billingDetails: null,
  deliveryFee: null,
  deliveryMethod: null,
  deliveryOption: null,
  deliveryDetails: null,
  deliveryInstructions: "",
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
  discount: null,

  // Payment method defaults
  paymentMethod: "online_payment",
  podPaymentMethod: null,
};

type CheckoutContextType = {
  activeSession: CheckoutSession;
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
  const [checkoutState, setCheckoutState] = useState<CheckoutState>(() => {
    if (typeof window === "undefined") return initialState;

    try {
      const savedState = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (savedState) {
        const parsed = JSON.parse(savedState);
        return {
          ...initialState,
          ...parsed,
          // Ensure new fields have defaults
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

  useEffect(() => {
    setNavBarLayout("fixed");
    setAppLocation("shop");
  }, []);

  useEffect(() => {
    if (bag?.items?.length && bag?.items?.length > 0) {
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ ...checkoutState, discount: null, bag })
      );
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

      const isGhanaAddress = country == "GH";

      const isGreaterAccraAddress = region == "GA";

      let deliveryOption: DeliveryOption = "intl";
      const shouldWaiveIntlFee = isFeeWaived(waiveDeliveryFees, "intl");
      let deliveryFee = shouldWaiveIntlFee
        ? 0
        : store?.config?.deliveryFees?.international || 800;

      if (isGhanaAddress) {
        deliveryOption = isGreaterAccraAddress
          ? "within-accra"
          : "outside-accra";

        const shouldWaiveRegionFee =
          typeof waiveDeliveryFees === "boolean"
            ? waiveDeliveryFees
            : isGreaterAccraAddress
              ? waiveDeliveryFees?.withinAccra ||
                waiveDeliveryFees?.all ||
                false
              : waiveDeliveryFees?.otherRegions ||
                waiveDeliveryFees?.all ||
                false;

        deliveryFee = shouldWaiveRegionFee
          ? 0
          : isGreaterAccraAddress
            ? 30
            : 70;
      }

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
    const anyFeeWaived = isAnyFeeWaived(waiveDeliveryFees);

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
      const isPickupOrder = newUpdates.deliveryMethod == "pickup";

      const isGhanaOrder =
        isPickupOrder ||
        (isDeliveryOrder && newUpdates.deliveryDetails?.country == "GH");

      // Always set international delivery for non-Ghana countries
      if (
        isDeliveryOrder &&
        newUpdates.deliveryDetails?.country &&
        newUpdates.deliveryDetails.country !== "GH" &&
        newUpdates.deliveryOption !== "intl"
      ) {
        const shouldWaiveIntlFee = isFeeWaived(waiveDeliveryFees, "intl");

        newUpdates.deliveryOption = "intl";
        newUpdates.deliveryFee = shouldWaiveIntlFee
          ? 0
          : store?.config?.deliveryFees?.international || 800;
      }

      const isUSOrder =
        isDeliveryOrder && newUpdates.deliveryDetails?.country == "US";

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
        newUpdates.deliveryDetails?.street && newUpdates.deliveryDetails?.region
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
      }}
    >
      {children}
    </CheckoutContext.Provider>
  );
};
