import { beforeEach, describe, expect, it } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import { useExpenseStore } from "./expenseStore";

describe("expenseStore", () => {
  beforeEach(() => {
    useExpenseStore.getState().resetAll();
  });

  it("preserves same-session optimistic cart items while session data catches up", () => {
    const store = useExpenseStore.getState();
    store.setCurrentSessionId("expense-session-1" as Id<"expenseSession">);
    store.addToCart({
      id: "optimistic:product-sku-2:trusted_inventory" as Id<"expenseSessionItem">,
      name: "Shop towels",
      barcode: "9876543210123",
      sku: "TOWEL-1",
      price: 1200,
      quantity: 1,
      image: null,
      size: "",
      length: null,
      color: "",
      productId: "product-2" as Id<"product">,
      skuId: "product-sku-2" as Id<"productSku">,
    });

    store.loadSessionData({
      _id: "expense-session-1" as Id<"expenseSession">,
      cartItems: [],
    });

    expect(useExpenseStore.getState().cart.items).toEqual([
      expect.objectContaining({
        id: "optimistic:product-sku-2:trusted_inventory",
        skuId: "product-sku-2",
        quantity: 1,
      }),
    ]);
  });

  it("replaces an optimistic row once session data represents it", () => {
    const store = useExpenseStore.getState();
    store.setCurrentSessionId("expense-session-1" as Id<"expenseSession">);
    store.addToCart({
      id: "optimistic:product-sku-2:trusted_inventory" as Id<"expenseSessionItem">,
      name: "Shop towels",
      barcode: "9876543210123",
      sku: "TOWEL-1",
      price: 1200,
      quantity: 1,
      image: null,
      size: "",
      length: null,
      color: "",
      productId: "product-2" as Id<"product">,
      skuId: "product-sku-2" as Id<"productSku">,
    });

    store.loadSessionData({
      _id: "expense-session-1" as Id<"expenseSession">,
      cartItems: [
        {
          _id: "expense-item-2" as Id<"expenseSessionItem">,
          productId: "product-2" as Id<"product">,
          productSkuId: "product-sku-2" as Id<"productSku">,
          productName: "Shop towels",
          productSku: "TOWEL-1",
          barcode: "9876543210123",
          price: 1200,
          quantity: 1,
        },
      ],
    });

    expect(useExpenseStore.getState().cart.items).toEqual([
      expect.objectContaining({
        id: "expense-item-2",
        skuId: "product-sku-2",
        quantity: 1,
      }),
    ]);
  });

  it("does not carry optimistic cart items into another expense session", () => {
    const store = useExpenseStore.getState();
    store.setCurrentSessionId("expense-session-1" as Id<"expenseSession">);
    store.addToCart({
      id: "optimistic:product-sku-2:trusted_inventory" as Id<"expenseSessionItem">,
      name: "Shop towels",
      barcode: "9876543210123",
      sku: "TOWEL-1",
      price: 1200,
      quantity: 1,
      image: null,
      size: "",
      length: null,
      color: "",
      productId: "product-2" as Id<"product">,
      skuId: "product-sku-2" as Id<"productSku">,
    });

    store.loadSessionData({
      _id: "expense-session-2" as Id<"expenseSession">,
      cartItems: [],
    });

    expect(useExpenseStore.getState().cart.items).toEqual([]);
  });

  it("stores cashier display name with the local cashier identity", () => {
    const store = useExpenseStore.getState();

    store.setCashier("staff-1" as Id<"staffProfile">, "Kwamina M.");

    expect(useExpenseStore.getState().cashier).toEqual({
      id: "staff-1",
      displayName: "Kwamina M.",
      isAuthenticated: true,
    });

    store.clearCashier();

    expect(useExpenseStore.getState().cashier).toEqual({
      id: null,
      displayName: null,
      isAuthenticated: false,
    });
  });
});
