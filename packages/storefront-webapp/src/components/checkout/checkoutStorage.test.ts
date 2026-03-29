import { beforeEach, describe, expect, it } from "vitest";
import { SESSION_STORAGE_KEY } from "@/lib/constants";
import { loadCheckoutState, saveCheckoutState } from "./checkoutStorage";

const initialState = {
  deliveryMethod: "pickup" as const,
  paymentMethod: "online_payment" as const,
  podPaymentMethod: null,
};

describe("loadCheckoutState", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns initial state when no saved state exists", () => {
    const result = loadCheckoutState(initialState as any);
    expect(result).toEqual(initialState);
  });

  it("merges saved state with initial state", () => {
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ deliveryMethod: "delivery" }),
    );

    const result = loadCheckoutState(initialState as any);
    expect(result.deliveryMethod).toBe("delivery");
    expect(result.paymentMethod).toBe("online_payment");
  });

  it("returns initial state when saved state is invalid JSON", () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, "not-json");
    const result = loadCheckoutState(initialState as any);
    expect(result).toEqual(initialState);
  });
});

describe("saveCheckoutState", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("saves state to session storage without discount", () => {
    saveCheckoutState({
      deliveryMethod: "pickup",
      discount: {
        id: "1",
        code: "TEST",
        type: "percentage",
        value: 10,
        span: "entire-order",
        isMultipleUses: false,
      },
      bag: { items: [{ id: "1" }] },
    } as any);

    const saved = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)!);
    expect(saved.deliveryMethod).toBe("pickup");
    expect(saved.discount).toBeNull();
    expect(saved.bag).toEqual({ items: [{ id: "1" }] });
  });
});
