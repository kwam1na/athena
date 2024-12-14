import React, { createContext, useContext, useEffect, useState } from "react";
import { z, ZodError } from "zod";
import { customerDetailsSchema } from "./CustomerDetails";
import { deliveryDetailsSchema } from "./DeliveryDetails";
import { billingDetailsSchema } from "./BillingDetails";

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

const webOrderSchema = z
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
};

// const initialState: CheckoutState = {
//   billingDetails: null,
//   deliveryFee: 800,
//   deliveryMethod: "delivery",
//   deliveryOption: "intl",

//   deliveryDetails: {
//     address: "124 Haudo Ct",
//     city: "Laurel",
//     state: "MD",
//     zip: "20707",
//     country: "US",
//   },

//   customerDetails: {
//     firstName: "Jon",
//     lastName: "Snow",
//     email: "j@sn.ow",
//     phoneNumber: "9013293309",
//   },
//   pickupLocation: null,

//   didEnterDeliveryDetails: true,
//   didEnterBillingDetails: false,
//   didSelectPickupLocation: false,

//   isUSOrder: true,
//   isGhanaOrder: false,
//   isROWOrder: false,
//   isPickupOrder: false,
//   isDeliveryOrder: true,
// };

type CheckoutStateErrors = {
  billingCountry: {
    hasError: boolean;
    message: string;
  };
  billingDetails: {
    billingAddressSameAsDelivery?: {
      hasError: boolean;
      message: string;
    };
    address: {
      hasError: boolean;
      message: string;
    };
    city: {
      hasError: boolean;
      message: string;
    };
    state: {
      hasError: boolean;
      message: string;
    };
    zip: {
      hasError: boolean;
      message: string;
    };
  };
  country: {
    hasError: boolean;
    message: string;
  };
  customerDetails: {
    firstName: {
      hasError: boolean;
      message: string;
    };
    lastName: {
      hasError: boolean;
      message: string;
    };
    email: {
      hasError: boolean;
      message: string;
    };
    phoneNumber: {
      hasError: boolean;
      message: string;
    };
  };
  deliveryMethod: {
    hasError: boolean;
    message: string;
  };
  deliveryOption: {
    hasError: boolean;
    message: string;
  };
  deliveryFee: {
    hasError: boolean;
    message: string;
  };
  deliveryDetails: {
    address: {
      hasError: boolean;
      message: string;
    };
    city: {
      hasError: boolean;
      message: string;
    };
    state: {
      hasError: boolean;
      message: string;
    };
    zip: {
      hasError: boolean;
      message: string;
    };
  };
};

const initialCheckoutErrorsState: CheckoutStateErrors = {
  billingCountry: {
    hasError: false,
    message: "",
  },
  billingDetails: {
    billingAddressSameAsDelivery: {
      hasError: false,
      message: "",
    },
    address: {
      hasError: false,
      message: "",
    },
    city: {
      hasError: false,
      message: "",
    },
    state: {
      hasError: false,
      message: "",
    },
    zip: {
      hasError: false,
      message: "",
    },
  },
  country: {
    hasError: false,
    message: "",
  },
  customerDetails: {
    firstName: {
      hasError: false,
      message: "",
    },
    lastName: {
      hasError: false,
      message: "",
    },
    email: {
      hasError: false,
      message: "",
    },
    phoneNumber: {
      hasError: false,
      message: "",
    },
  },
  deliveryMethod: {
    hasError: false,
    message: "",
  },
  deliveryOption: {
    hasError: false,
    message: "",
  },
  deliveryFee: {
    hasError: false,
    message: "",
  },
  deliveryDetails: {
    address: {
      hasError: false,
      message: "",
    },
    city: {
      hasError: false,
      message: "",
    },
    state: {
      hasError: false,
      message: "",
    },
    zip: {
      hasError: false,
      message: "",
    },
  },
};

type CheckoutContextType = {
  actionsState: CheckoutActions;
  checkoutState: CheckoutState;
  checkoutErrors: CheckoutStateErrors;
  canPlaceOrder: () => boolean;
  validate: () => void;
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
  const [checkoutState, setCheckoutState] = useState(initialState);
  const [checkoutErrors, setCheckoutErrors] = useState(
    initialCheckoutErrorsState
  );

  const [actionsState, setActionsState] = useState(initialActionsState);

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

  const validate = () => {
    try {
      // Parse the state using the schema
      webOrderSchema.parse(checkoutState);

      updateState({ failedFinalValidation: false });

      // If validation succeeds, clear all errors
      setCheckoutErrors(initialCheckoutErrorsState);
    } catch (e) {
      if (e instanceof z.ZodError) {
        // Create a mutable errors object
        const errors = JSON.parse(JSON.stringify(initialCheckoutErrorsState));

        // Map through Zod errors to populate the errors object
        e.errors.forEach((error) => {
          const [field, subField] = error.path;

          if (subField) {
            // Handle nested errors (e.g., billingDetails.address)
            (errors as any)[field][subField] = {
              hasError: true,
              message: error.message,
            };
          } else {
            // Handle top-level errors
            (errors as any)[field] = {
              hasError: true,
              message: error.message,
            };
          }
        });

        // Update the errors state
        setCheckoutErrors(errors);
      } else {
        console.error("Unexpected error during validation:", e);
      }

      updateState({ failedFinalValidation: true });
    }
  };

  const canPlaceOrder = () => {
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

  return (
    <CheckoutContext.Provider
      value={{
        actionsState,
        checkoutState,
        checkoutErrors,
        canPlaceOrder,
        validate,
        updateState,
        updateActionsState,
      }}
    >
      {children}
    </CheckoutContext.Provider>
  );
};
