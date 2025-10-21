import { useContext } from "react";
import { CheckoutContext } from "@/components/checkout/CheckoutProvider";
import { CheckoutContextType } from "@/components/checkout/types";

export const useCheckout = (): CheckoutContextType => {
  const context = useContext(CheckoutContext);
  if (!context) {
    throw new Error("useCheckout must be used within a CheckoutContext");
  }
  return context;
};
