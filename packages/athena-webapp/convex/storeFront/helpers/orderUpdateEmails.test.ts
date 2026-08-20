import { beforeEach, describe, expect, it, vi } from "vitest";

const sendOrderEmail = vi.hoisted(() => vi.fn());

vi.mock("../../mailersend", () => ({ sendOrderEmail }));

import { handleOrderStatusUpdate } from "./orderUpdateEmails";

const store = {
  currency: "GHS",
  name: "osu flagship",
  config: { contactInfo: { location: "Oxford Street, Osu" } },
} as any;

const order = {
  _creationTime: Date.UTC(2026, 7, 20),
  amount: 10_000,
  customerDetails: {
    email: "ama@example.com",
    firstName: "Ama",
    lastName: "Mensah",
  },
  deliveryDetails: "9 Cashew Link, Accra",
  deliveryFee: 0,
  deliveryMethod: "delivery",
  discount: null,
  items: [],
  orderNumber: "ORDER-1",
} as any;

describe("fulfillment order update emails", () => {
  beforeEach(() => {
    sendOrderEmail.mockReset();
    sendOrderEmail.mockResolvedValue(new Response(null, { status: 202 }));
  });

  it("sends ready-for-pickup with active hours and without them as a fallback", async () => {
    const pickupOrder = { ...order, deliveryMethod: "pickup" };
    const schedule = {
      weeklyClosedDays: [0],
      weeklyWindows: [
        { dayOfWeek: 1, startMinute: 540, endMinute: 1080 },
      ],
    };

    await expect(
      handleOrderStatusUpdate({
        newStatus: "ready-for-pickup",
        order: pickupOrder,
        store,
        storeSchedule: schedule,
      }),
    ).resolves.toEqual({ didSendReadyEmail: true });
    expect(sendOrderEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pickup_hours: [
          { dayLabel: "Mon", hoursLabel: "9:00 AM–6:00 PM" },
          { dayLabel: "Tue–Sun", hoursLabel: "Closed" },
        ],
        status_title: "Your order is ready for pickup",
      }),
    );

    await handleOrderStatusUpdate({
      newStatus: "ready-for-pickup",
      order: pickupOrder,
      store,
      storeSchedule: null,
    });
    expect(sendOrderEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({ pickup_hours: [] }),
    );
  });

  it("sends ready-for-delivery once without suppressing the later delivery update", async () => {
    await expect(
      handleOrderStatusUpdate({
        newStatus: "ready-for-delivery",
        order,
        store,
      }),
    ).resolves.toEqual({ didSendReadyForDeliveryEmail: true });

    await expect(
      handleOrderStatusUpdate({
        newStatus: "ready-for-delivery",
        order: { ...order, didSendReadyForDeliveryEmail: true },
        store,
      }),
    ).resolves.toBeUndefined();

    await expect(
      handleOrderStatusUpdate({
        newStatus: "out-for-delivery",
        order: { ...order, didSendReadyForDeliveryEmail: true },
        store,
      }),
    ).resolves.toEqual({ didSendReadyEmail: true });
    expect(sendOrderEmail).toHaveBeenCalledTimes(2);
  });
});
