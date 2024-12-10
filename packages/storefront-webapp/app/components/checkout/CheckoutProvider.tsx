import React, { createContext, useContext, useEffect, useState } from "react";

type Address = {
  address: string;
  city: string;
  state: string;
  zip: number;
};

type CustomerDetails = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
};

type CheckoutState = {
  deliveryMethod: "delivery" | "pickup" | null;
  deliveryOption: "within-accra" | "outside-accra" | "intl" | null;
  deliveryFee: number | null;
  country: string | null;
  billingCountry: string | null;
  deliveryDetails: Address | null;
  billingDetails: Address | null;
  customerDetails: CustomerDetails | null;
  billingAddressSameAsDelivery: boolean;
};

const initialState: CheckoutState = {
  deliveryMethod: null,
  deliveryOption: null,
  billingDetails: null,
  deliveryFee: null,
  country: "GH",
  billingCountry: null,
  deliveryDetails: null,
  customerDetails: null,
  billingAddressSameAsDelivery: false,
};

type CheckoutContextType = {
  checkoutState: CheckoutState;
  updateState: (newState: Partial<CheckoutState>) => void;
};

const CheckoutContext = createContext<CheckoutContextType | null>(null);

export const useCheckout = () => {
  const context = useContext(CheckoutContext);
  if (!context) {
    throw new Error("useCheckout must be used within a CheckoutProvider");
  }
  return context;
};

export const CheckoutProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [checkoutState, setCheckoutState] = useState(initialState);

  useEffect(() => {
    const determineRegion = () => {
      try {
        const region = new Intl.Locale(navigator.language).region || "GH";
        setCheckoutState((prev) => ({
          ...prev,
          country: region,
        }));
      } catch {
        setCheckoutState((prev) => ({
          ...prev,
          country: "GH",
        }));
      }
    };

    determineRegion();
  }, []);

  const updateState = (updates: Partial<CheckoutState>) => {
    setCheckoutState((prev) => ({ ...prev, ...updates }));
  };

  return (
    <CheckoutContext.Provider value={{ checkoutState, updateState }}>
      {children}
    </CheckoutContext.Provider>
  );
};
