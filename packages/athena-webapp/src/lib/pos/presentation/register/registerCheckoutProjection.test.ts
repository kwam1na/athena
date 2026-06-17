import { describe, expect, it } from "vitest";

import type { CartItem } from "@/components/pos/types";

import {
  buildCompletedSalePayload,
  buildServiceCheckoutBlockMessage,
  combinePaymentsByMethod,
  completedCustomerInfo,
} from "./registerCheckoutProjection";
import { EMPTY_REGISTER_CUSTOMER_INFO } from "./registerUiState";
import type { RegisterServiceLineState } from "./registerUiState";

const fixedService: RegisterServiceLineState = {
  amountRequired: false,
  id: "service-line-1",
  name: "Closure Repair",
  price: 45,
  pricingModel: "fixed",
  quantity: 1,
  serviceCatalogId: "service-1" as never,
  serviceMode: "repair",
};

describe("registerCheckoutProjection", () => {
  it("blocks service checkout until customer and service amount requirements pass", () => {
    expect(
      buildServiceCheckoutBlockMessage({
        customerInfo: EMPTY_REGISTER_CUSTOMER_INFO,
        serviceItems: [fixedService],
      }),
    ).toBe("Customer required. Add a customer before checking out services.");

    expect(
      buildServiceCheckoutBlockMessage({
        customerInfo: {
          ...EMPTY_REGISTER_CUSTOMER_INFO,
          customerProfileId: "customer-1" as never,
        },
        serviceItems: [
          {
            ...fixedService,
            price: 0,
            pricingModel: "starting_at",
          },
        ],
      }),
    ).toBe("Service amount required. Enter the service amount before checkout.");
  });

  it("combines same-method payments while keeping the latest timestamp", () => {
    expect(
      combinePaymentsByMethod([
        { amount: 10, id: "cash-1", method: "cash", timestamp: 100 },
        { amount: 15, id: "card-1", method: "card", timestamp: 110 },
        { amount: 5, id: "cash-2", method: "cash", timestamp: 120 },
      ]),
    ).toEqual([
      { amount: 15, id: "cash-1", method: "cash", timestamp: 120 },
      { amount: 15, id: "card-1", method: "card", timestamp: 110 },
    ]);
  });

  it("omits blank customers from completed sale payloads", () => {
    const payload = buildCompletedSalePayload({
      cartItems: [
        {
          id: "item-1",
          name: "Wig",
          price: 100,
          productId: "product-1",
          quantity: 1,
          skuId: "sku-1",
        } as unknown as CartItem,
      ],
      customerInfo: EMPTY_REGISTER_CUSTOMER_INFO,
      localPosSessionId: "local-sale-1",
      localReceiptNumber: "LOCAL-1",
      localTransactionId: "local-transaction-1",
      payments: [{ amount: 100, id: "payment-1", method: "cash", timestamp: 1 }],
      receiptNumber: "R-1",
      serviceItems: [],
      totals: { subtotal: 100, tax: 0, total: 100 },
    });

    expect(payload.customerName).toBeUndefined();
    expect(payload.customerEmail).toBeUndefined();
    expect(completedCustomerInfo(EMPTY_REGISTER_CUSTOMER_INFO)).toBeUndefined();
  });
});
