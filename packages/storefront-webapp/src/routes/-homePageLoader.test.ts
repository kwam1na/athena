import { describe, expect, it, vi } from "vitest";

import { loadHomePageData } from "./-homePageLoader";

describe("loadHomePageData", () => {
  it("keeps fulfilled merchandising data when the companion request fails", async () => {
    const storeRequest = vi.fn().mockResolvedValue({ _id: "store" });
    const bestSellersRequest = vi.fn().mockResolvedValue([{ _id: "best-seller" }]);
    const featuredRequest = vi.fn().mockRejectedValue(new Error("featured failed"));

    const result = await loadHomePageData({
      storeRequest,
      bestSellersRequest,
      featuredRequest,
    });

    expect(storeRequest).toHaveBeenCalledBefore(bestSellersRequest);
    expect(storeRequest).toHaveBeenCalledBefore(featuredRequest);
    expect(result.bestSellers?.data).toEqual([{ _id: "best-seller" }]);
    expect(result.bestSellers?.updatedAt).toEqual(expect.any(Number));
    expect(result.featured).toBeUndefined();
  });

  it("records freshness timestamps for fulfilled loader data", async () => {
    const result = await loadHomePageData({
      storeRequest: vi.fn().mockResolvedValue({ _id: "store" }),
      bestSellersRequest: vi.fn().mockResolvedValue([{ _id: "best-seller" }]),
      featuredRequest: vi.fn().mockResolvedValue([{ _id: "featured" }]),
    });

    expect(result.bestSellers?.updatedAt).toEqual(expect.any(Number));
    expect(result.featured?.updatedAt).toEqual(expect.any(Number));
    expect(result.bestSellers?.updatedAt).toBe(result.featured?.updatedAt);
  });

  it("does not load merchandising when the storefront bootstrap fails", async () => {
    const bestSellersRequest = vi.fn().mockResolvedValue([{ _id: "best-seller" }]);
    const featuredRequest = vi.fn().mockResolvedValue([{ _id: "featured" }]);

    await expect(
      loadHomePageData({
        storeRequest: vi.fn().mockRejectedValue(new Error("store failed")),
        bestSellersRequest,
        featuredRequest,
      }),
    ).rejects.toThrow("store failed");

    expect(bestSellersRequest).not.toHaveBeenCalled();
    expect(featuredRequest).not.toHaveBeenCalled();
  });
});
