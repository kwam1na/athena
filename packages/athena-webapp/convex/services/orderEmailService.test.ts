import { describe, expect, it } from "vitest";

import { buildPickupDetails } from "./orderEmailService";
import {
  formatPickupLocation,
  formatStoreScheduleHours,
} from "../emails/fulfillmentDetails";

describe("buildPickupDetails", () => {
  it("leads pickup locations with the store name", () => {
    expect(
      buildPickupDetails({
        deliveryMethod: "pickup",
        deliveryDetails: undefined,
        storeName: "wigclub",
        storeLocation: "2 Jungle Avenue, East Legon, Accra",
      }),
    ).toBe("Wigclub · 2 Jungle Avenue, East Legon, Accra");
  });

  it("formats delivery addresses without optional Ghana house numbers", () => {
    expect(
      buildPickupDetails({
        deliveryMethod: "delivery",
        deliveryDetails: {
          country: "GH",
          region: "Greater Accra",
          neighborhood: "Adjiringanor",
          street: "Cashew Link",
        },
      }),
    ).toBe("Cashew Link, Adjiringanor, Greater Accra, Ghana");
  });

  it("keeps a useful fallback when a pickup location is unavailable", () => {
    expect(
      formatPickupLocation({ storeName: "wIGClUb", storeLocation: undefined }),
    ).toBe("Wigclub · Location not available");
  });

  it("groups matching store hours into a compact weekly schedule", () => {
    expect(
      formatStoreScheduleHours({
        weeklyClosedDays: [0],
        weeklyWindows: [
          ...[1, 2, 3, 4, 5].map((dayOfWeek) => ({
            dayOfWeek,
            startMinute: 9 * 60,
            endMinute: 18 * 60,
          })),
          { dayOfWeek: 6, startMinute: 10 * 60, endMinute: 14 * 60 },
        ],
      }),
    ).toEqual([
      { dayLabel: "Mon–Fri", hoursLabel: "9:00 AM–6:00 PM" },
      { dayLabel: "Sat", hoursLabel: "10:00 AM–2:00 PM" },
      { dayLabel: "Sun", hoursLabel: "Closed" },
    ]);
  });

  it("omits store hours when no active schedule is available", () => {
    expect(formatStoreScheduleHours(null)).toEqual([]);
  });
});
