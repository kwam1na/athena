import React, { createContext, useContext, useEffect, useState } from "react";
import { z, ZodError } from "zod";
import { customerDetailsSchema } from "./CustomerDetails";
import { deliveryDetailsSchema } from "./DeliveryDetails";
import { billingDetailsSchema } from "./BillingDetails";
import { deliveryMethodSchema, deliveryOptionSchema } from "./DeliverySection";

export type Address = {
  address: string;
  city: string;
  state?: string;
  zip?: string;
};

export type CustomerDetails = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
};

const webOrderSchema = z.object({
  billingCountry: z.string().min(1),
  billingDetails: billingDetailsSchema,
  country: z.string().min(1),
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
  deliveryDetails: deliveryDetailsSchema,
});

type CheckoutState = {
  billingCountry: string | null;
  billingDetails: (Address & { billingAddressSameAsDelivery?: boolean }) | null;
  country: string | null;
  region_gh: string | null;
  region_gh_name: string | null;
  customerDetails: CustomerDetails | null;
  deliveryMethod: "delivery" | "pickup" | null;
  deliveryOption: "within-accra" | "outside-accra" | "intl" | null;
  deliveryFee: number | null;
  deliveryDetails: Address | null;
  pickupLocation: string | null;
};

type CheckoutActions = {
  isEditingCustomerDetails: boolean;
  isEditingDeliveryDetails: boolean;
  isEditingBillingDetails: boolean;
};

const initialActionsState: CheckoutActions = {
  isEditingCustomerDetails: false,
  isEditingDeliveryDetails: false,
  isEditingBillingDetails: false,
};

const initialState: CheckoutState = {
  deliveryMethod: "delivery",
  deliveryOption: "intl",
  billingDetails: null,
  deliveryFee: 800,
  country: "GH",
  region_gh: "GA",
  region_gh_name: "Greater Accra",
  billingCountry: null,
  deliveryDetails: {
    address: "124 Haudo Ct",
    city: "Laurel",
    state: "MD",
    zip: "20707",
  },
  customerDetails: {
    firstName: "Jon",
    lastName: "Snow",
    email: "j@sn.ow",
    phoneNumber: "9013293309",
  },
  pickupLocation: null,
};

// const initialState: CheckoutState = {
//   deliveryMethod: null,
//   deliveryOption: null,
//   billingDetails: null,
//   deliveryFee: null,
//   country: null,
//   region_gh: null,
//   region_gh_name: null,
//   billingCountry: null,
//   deliveryDetails: null,
//   customerDetails: null,
//   pickupLocation: null,
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
          country: region,
          billingCountry: region,
        }));
      } catch {
        setCheckoutState((prev) => ({
          ...prev,
          country: "GH",
          billingCountry: "GH",
        }));
      }
    };

    determineRegion();
  }, []);

  const updateState = (updates: Partial<CheckoutState>) => {
    setCheckoutState((prev) => ({ ...prev, ...updates }));
  };

  const updateActionsState = (actions: Partial<CheckoutActions>) => {
    setActionsState((prev) => ({ ...prev, ...actions }));
  };

  const validate = () => {
    try {
      // Parse the state using the schema
      webOrderSchema.parse(checkoutState);

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
    }
  };

  const canPlaceOrder = () => {
    try {
      // Parse the state using the schema
      webOrderSchema.parse(checkoutState);

      return true;
    } catch (e) {
      console.log((e as ZodError).errors);
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
