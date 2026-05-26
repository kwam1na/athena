import { describe, expect, it } from "vitest";

import { buildPickupDetails } from "./orderEmailService";

describe("buildPickupDetails", () => {
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
});
