import { describe, expect, it } from "vitest";

import { getAddressString } from "./utils";
import type { Address } from "../types";

describe("getAddressString", () => {
  it("omits missing Ghana house numbers from formatted addresses", () => {
    const address = {
      country: "GH",
      region: "Greater Accra",
      neighborhood: "Adjiringanor",
      street: "Cashew Link",
    } satisfies Address;

    expect(getAddressString(address)).toBe(
      "Cashew Link, Adjiringanor, Greater Accra, Ghana",
    );
  });

  it("keeps Ghana house numbers when provided", () => {
    const address = {
      country: "GH",
      region: "Greater Accra",
      neighborhood: "Adjiringanor",
      street: "Cashew Link",
      houseNumber: "15",
    } satisfies Address;

    expect(getAddressString(address)).toBe(
      "15, Cashew Link, Adjiringanor, Greater Accra, Ghana",
    );
  });
});
