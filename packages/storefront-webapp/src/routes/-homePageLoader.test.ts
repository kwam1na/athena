import { describe, expect, it, vi } from "vitest";

import { loadHomePageData } from "./-homePageLoader";

describe("loadHomePageData", () => {
  it("loads the homepage snapshot as the first-render content contract", async () => {
    const snapshotRequest = vi.fn().mockResolvedValue({
      contractVersion: "homepage_snapshot.v1",
      bestSellers: [{ id: "best-seller" }],
      featuredItems: [{ id: "highlighted" }],
      shopLook: null,
    });

    const result = await loadHomePageData({
      snapshotRequest,
    });

    expect(snapshotRequest).toHaveBeenCalledWith({ asNewUser: false });
    expect(result.snapshot.data).toEqual({
      contractVersion: "homepage_snapshot.v1",
      bestSellers: [{ id: "best-seller" }],
      featuredItems: [{ id: "highlighted" }],
      shopLook: null,
    });
    expect(result.snapshot.updatedAt).toEqual(expect.any(Number));
  });

  it("preserves successful empty and null snapshot sections", async () => {
    const result = await loadHomePageData({
      snapshotRequest: vi.fn().mockResolvedValue({
        contractVersion: "homepage_snapshot.v1",
        bestSellers: [],
        featuredItems: [],
        shopLook: null,
      }),
    });

    expect(result.snapshot.data.bestSellers).toEqual([]);
    expect(result.snapshot.data.featuredItems).toEqual([]);
    expect(result.snapshot.data.shopLook).toBeNull();
    expect(result.snapshot.updatedAt).toEqual(expect.any(Number));
  });

  it("rejects when the snapshot request fails", async () => {
    await expect(
      loadHomePageData({
        snapshotRequest: vi.fn().mockRejectedValue(new Error("snapshot failed")),
      }),
    ).rejects.toThrow("snapshot failed");
  });
});
