import { describe, expect, it } from "vitest";

import { getCategoryProductAvailability } from "./ProductsListView";

describe("ProductsListView category query", () => {
  it("requests live products for the reserved POS quick-add category", () => {
    expect(getCategoryProductAvailability("pos-quick-add")).toBe("live");
  });

  it("requests live products for the reserved POS pending-checkout category", () => {
    expect(getCategoryProductAvailability("pos-pending-checkout")).toBe("live");
  });

  it("leaves normal category queries on the default visible live-product path", () => {
    expect(getCategoryProductAvailability("hair")).toBeUndefined();
    expect(getCategoryProductAvailability(undefined)).toBeUndefined();
  });
});
