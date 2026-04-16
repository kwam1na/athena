import { describe, expect, it, vi } from "vitest";

import { loadHomePageData } from "./-homePageLoader";

describe("loadHomePageData", () => {
  it("keeps fulfilled merchandising data when the companion request fails", async () => {
    const bestSellersRequest = vi.fn().mockResolvedValue([{ _id: "best-seller" }]);
    const featuredRequest = vi.fn().mockRejectedValue(new Error("featured failed"));

    const result = await loadHomePageData({
      bestSellersRequest,
      featuredRequest,
    });

    expect(result.bestSellers?.data).toEqual([{ _id: "best-seller" }]);
    expect(result.bestSellers?.updatedAt).toEqual(expect.any(Number));
    expect(result.featured).toBeUndefined();
  });

  it("records freshness timestamps for fulfilled loader data", async () => {
    const result = await loadHomePageData({
      bestSellersRequest: vi.fn().mockResolvedValue([{ _id: "best-seller" }]),
      featuredRequest: vi.fn().mockResolvedValue([{ _id: "featured" }]),
    });

    expect(result.bestSellers?.updatedAt).toEqual(expect.any(Number));
    expect(result.featured?.updatedAt).toEqual(expect.any(Number));
    expect(result.bestSellers?.updatedAt).toBe(result.featured?.updatedAt);
  });
});
