import { describe, expect, it } from "vitest";

import { buildOperationalEventMessage } from "./eventBuilders";

describe("buildOperationalEventMessage", () => {
  it("uses operator-friendly copy for online order operational events", () => {
    const expectedMessages: Record<string, string> = {
      online_order_cancelled: "Online order #273912 cancelled.",
      online_order_created: "Online order #273912 created.",
      online_order_delivered: "Online order #273912 delivered.",
      online_order_exchange_balance_collection:
        "Exchange balance collected for online order #273912.",
      online_order_exchange_processed:
        "Exchange processed for online order #273912.",
      online_order_item_restocked:
        "Returned item restocked for online order #273912.",
      online_order_out_for_delivery: "Online order #273912 out for delivery.",
      online_order_payment_collected:
        "Payment collected for online order #273912.",
      online_order_payment_verified:
        "Payment verified for online order #273912.",
      online_order_picked_up: "Online order #273912 picked up.",
      online_order_pickup_exception:
        "Pickup exception recorded for online order #273912.",
      online_order_ready_for_delivery:
        "Online order #273912 ready for delivery.",
      online_order_ready_for_pickup: "Online order #273912 ready for pickup.",
      online_order_refund_submitted:
        "Refund submitted for online order #273912.",
      online_order_reservation_released:
        "Reservation released for online order #273912.",
      online_order_return_approval_requested:
        "Return or exchange for online order #273912 sent for approval.",
      online_order_return_processed:
        "Return processed for online order #273912.",
      online_order_return_refund: "Refund recorded for online order #273912.",
      online_order_status_changed: "Online order #273912 status changed.",
    };

    for (const [eventType, expectedMessage] of Object.entries(
      expectedMessages,
    )) {
      expect(
        buildOperationalEventMessage({
          eventType,
          subjectLabel: "273912",
          subjectType: "online_order",
        }),
      ).toBe(expectedMessage);
    }
  });

  it("uses operator-friendly copy for stock adjustment decision events", () => {
    const expectedMessages: Record<string, string> = {
      stock_adjustment_approved: "Stock adjustment approved for 1 SKU.",
      stock_adjustment_cancelled: "Stock adjustment cancelled for 1 SKU.",
      stock_adjustment_rejected: "Stock adjustment rejected for 1 SKU.",
    };

    for (const [eventType, expectedMessage] of Object.entries(
      expectedMessages,
    )) {
      expect(
        buildOperationalEventMessage({
          eventType,
          subjectLabel: "Stock adjustment review · 1 SKU",
          subjectType: "stock_adjustment_batch",
        }),
      ).toBe(expectedMessage);
    }
  });
});
