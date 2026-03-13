// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  capitalizeWords,
  currencyFormatter,
  formatDate,
  getAddressString,
  toSlug,
} from "./utils";

describe("convex utils", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T12:00:00.000Z"));
  });

  it("slugifies inventory strings", () => {
    expect(toSlug("  Front Lace Wig!  ")).toBe("front-lace-wig");
  });

  it("formats Ghana addresses using labels from constants", () => {
    expect(
      getAddressString({
        country: "GH",
        region: "GA",
        neighborhood: "east_legon",
        houseNumber: "12B",
        street: "Lagos Avenue",
      } as never)
    ).toBe("12B, Lagos Avenue, East Legon, Greater Accra, Ghana");
  });

  it("formats US and fallback addresses", () => {
    expect(
      getAddressString({
        country: "US",
        address: "123 Main St",
        city: "Austin",
        state: "TX",
        zip: "78701",
      } as never)
    ).toBe("123 Main St, Austin, TX 78701, United States");

    expect(
      getAddressString({
        country: "CA",
        address: "456 King St W",
        city: "Toronto",
      } as never)
    ).toBe("456 King St W, Toronto, Canada");
  });

  it("formats display values", () => {
    expect(capitalizeWords("nATURAL black")).toBe("Natural Black");
    expect(currencyFormatter("USD").format(2450)).toBe("$2,450");
    expect(formatDate(Date.UTC(2026, 2, 13, 12, 0, 0))).toBe("Mar 13, 2026");
  });
});
