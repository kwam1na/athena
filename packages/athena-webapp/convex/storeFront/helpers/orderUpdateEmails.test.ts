import { beforeEach, describe, expect, it, vi } from "vitest";

const sendOrderEmail = vi.hoisted(() => vi.fn());

vi.mock("../../mailersend", () => ({ sendOrderEmail }));

import { formatOrderItems, handleOrderStatusUpdate } from "./orderUpdateEmails";

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

describe("fulfillment email line-item discount units", () => {
  const items = [
    {
      price: 15_000,
      productName: "body wave",
      productSkuId: "sku_a",
      quantity: 2,
    },
  ];

  it("renders a fixed-amount discount as pesewas converted once at display", () => {
    // GHS 25.00 off, stored as 2_500 pesewas.
    const [line] = formatOrderItems(items, "GHS", {
      discountType: "amount",
      discountValue: 2_500,
      span: "entire-order",
    });

    // `savings` is the per-unit discount times quantity, which is how this
    // helper has always summarised an entire-order fixed discount. Pinned as
    // observed behaviour; only the pesewas scale is asserted as a contract.
    expect(line).toMatchObject({
      price: "GH\u20B5150",
      discountedPrice: "GH\u20B5125",
      savings: "GH\u20B550",
    });
  });

  it("renders a percentage discount on the same pesewas scale", () => {
    const [line] = formatOrderItems(items, "GHS", {
      discountType: "percentage",
      discountValue: 10,
      span: "entire-order",
    });

    expect(line).toMatchObject({
      price: "GH\u20B5150",
      discountedPrice: "GH\u20B5135",
      savings: "GH\u20B530",
    });
  });
});
