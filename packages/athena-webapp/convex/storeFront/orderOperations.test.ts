import { describe, expect, it } from "vitest";
import {
  assertValidOnlineOrderStatusTransition,
  getOnlineOrderPaymentAmount,
  getOnlineOrderPaymentMethodLabel,
  getOnlineOrderStatusEventType,
} from "./helpers/orderOperations";

describe("online order operations helper mappings", () => {
  it("maps lifecycle statuses into shared operational event types", () => {
    expect(getOnlineOrderStatusEventType("ready-for-pickup")).toBe(
      "online_order_ready_for_pickup"
    );
    expect(getOnlineOrderStatusEventType("pickup-exception")).toBe(
      "online_order_pickup_exception"
    );
    expect(getOnlineOrderStatusEventType("picked-up")).toBe(
      "online_order_picked_up"
    );
    expect(getOnlineOrderStatusEventType("refund-submitted")).toBe(
      "online_order_refund_submitted"
    );
  });

  it("prefers payment due when shaping shared payment allocations", () => {
    expect(
      getOnlineOrderPaymentAmount({
        amount: 12000,
        paymentDue: 9500,
      } as any)
    ).toBe(9500);
  });

  it("prefers POD collection methods and online channels when labeling payments", () => {
    expect(
      getOnlineOrderPaymentMethodLabel({
        isPODOrder: true,
        paymentMethod: {
          podPaymentMethod: "cash",
          type: "payment_on_delivery",
        },
        podPaymentMethod: "mobile_money",
      } as any)
    ).toBe("mobile_money");

    expect(
      getOnlineOrderPaymentMethodLabel({
        paymentMethod: {
          channel: "card",
          type: "online_payment",
        },
      } as any)
    ).toBe("card");
  });

  it("allows the pickup operational flow to move through ready, exception, and collected states", () => {
    expect(() =>
      assertValidOnlineOrderStatusTransition(
        {
          deliveryMethod: "pickup",
          paymentCollected: false,
          paymentMethod: {
            podPaymentMethod: "cash",
            type: "payment_on_delivery",
          },
          status: "ready-for-pickup",
        } as any,
        "pickup-exception",
      ),
    ).not.toThrow();

    expect(() =>
      assertValidOnlineOrderStatusTransition(
        {
          deliveryMethod: "pickup",
          paymentCollected: false,
          paymentMethod: {
            podPaymentMethod: "cash",
            type: "payment_on_delivery",
          },
          status: "pickup-exception",
        } as any,
        "ready-for-pickup",
      ),
    ).not.toThrow();

    expect(() =>
      assertValidOnlineOrderStatusTransition(
        {
          deliveryMethod: "pickup",
          paymentCollected: true,
          paymentMethod: {
            podPaymentMethod: "cash",
            type: "payment_on_delivery",
          },
          status: "ready-for-pickup",
        } as any,
        "picked-up",
      ),
    ).not.toThrow();
  });

  it("blocks pickup completion until payment-on-pickup has been collected and prevents double completion", () => {
    expect(() =>
      assertValidOnlineOrderStatusTransition(
        {
          deliveryMethod: "pickup",
          paymentCollected: false,
          paymentMethod: {
            podPaymentMethod: "cash",
            type: "payment_on_delivery",
          },
          status: "ready-for-pickup",
        } as any,
        "picked-up",
      ),
    ).toThrow(/collect payment/i);

    expect(() =>
      assertValidOnlineOrderStatusTransition(
        {
          deliveryMethod: "pickup",
          paymentCollected: true,
          paymentMethod: {
            podPaymentMethod: "cash",
            type: "payment_on_delivery",
          },
          status: "picked-up",
        } as any,
        "picked-up",
      ),
    ).toThrow(/already completed/i);
  });
});
