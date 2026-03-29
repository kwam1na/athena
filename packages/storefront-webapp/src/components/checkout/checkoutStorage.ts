import { SESSION_STORAGE_KEY } from "@/lib/constants";
import { CheckoutState } from "./types";

export function loadCheckoutState(initialState: CheckoutState): CheckoutState {
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
}

export function saveCheckoutState(state: CheckoutState): void {
  sessionStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ ...state, discount: null })
  );
}
