// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as routes from "./index";

describe("storeFront routes index exports", () => {
  it("re-exports route modules used by http wiring", () => {
    expect(routes).toHaveProperty("bagRoutes");
    expect(routes).toHaveProperty("checkoutRoutes");
    expect(routes).toHaveProperty("e2eRoutes");
    expect(routes).toHaveProperty("meRoutes");
    expect(routes).toHaveProperty("offersRoutes");
    expect(routes).toHaveProperty("onlineOrderRoutes");
    expect(routes).toHaveProperty("paystackRoutes");
    expect(routes).toHaveProperty("reviewRoutes");
    expect(routes).toHaveProperty("rewardsRoutes");
    expect(routes).toHaveProperty("storefrontRoutes");
    expect(routes).toHaveProperty("upsellRoutes");
    expect(routes).toHaveProperty("userOffersRoutes");
    expect(routes).toHaveProperty("userRoutes");
  });
});
