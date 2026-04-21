import { describe, expect, it } from "vitest";
import {
  getOnlineOrderPaymentAmount,
  getOnlineOrderPaymentMethodLabel,
  getOnlineOrderStatusEventType,
} from "./helpers/orderOperations";

describe("online order operations helper mappings", () => {
  it("maps lifecycle statuses into shared operational event types", () => {
    expect(getOnlineOrderStatusEventType("ready-for-pickup")).toBe(
      "online_order_ready_for_pickup"
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
});
