import { Dispatch, SetStateAction, useEffect } from "react";
import { Bag } from "@athena/webapp";
import { SESSION_STORAGE_KEY } from "@/lib/constants";
import { CheckoutState } from "../types";

export function useCheckoutPersistence(
  checkoutState: CheckoutState,
  bag: Bag | undefined,
  setCheckoutState: Dispatch<SetStateAction<CheckoutState>>
): void {
  // Persist state to sessionStorage whenever it changes (only when bag has items)
  useEffect(() => {
    if (bag?.items?.length && bag?.items?.length > 0) {
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ ...checkoutState, discount: null, bag })
      );
    }
  }, [checkoutState, bag]);

  // Clear discount and sync bag into state when bag updates
  useEffect(() => {
    if (bag?.items?.length && bag?.items?.length > 0) {
      setCheckoutState((prev) => ({
        ...prev,
        discount: null,
        bag,
      }));
    }
  }, [bag]);
}
