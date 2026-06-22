import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MARKER_KEY } from "@/lib/constants";
import { getHomepageSnapshot } from "./homepageSnapshot";

vi.mock("@/config", () => ({
  default: {
    apiGateway: {
      URL: "https://api.example.test",
    },
    storefront: {
      storeName: "wigclub",
    },
  },
}));

const snapshot = {
  contractVersion: "homepage_snapshot.v1",
  generatedAtMs: 1,
  store: {
    id: "store-1",
    organizationId: "org-1",
    name: "Wig Club",
    slug: "wigclub",
    currency: "GHS",
  },
  hero: {
    displayType: "image",
    headerImageUrl: null,
    showOverlay: false,
    showText: true,
    activeReelVersion: null,
    activeReelHlsUrl: null,
    fallbackImageUrl: null,
    shopTheLookImageUrl: null,
  },
  bannerMessage: null,
  bestSellers: [],
  featuredItems: [],
  shopLook: null,
};

describe("getHomepageSnapshot", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists a marker and requests the snapshot with storefront bootstrap params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(snapshot),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHomepageSnapshot({ asNewUser: true })).resolves.toEqual(
      snapshot,
    );

    const [url, init] = fetchMock.mock.calls[0];
    const requestUrl = new URL(url);

    expect(requestUrl.origin + requestUrl.pathname).toBe(
      "https://api.example.test/homepage-snapshot",
    );
    expect(requestUrl.searchParams.get("storeName")).toBe("wigclub");
    expect(requestUrl.searchParams.get("asNewUser")).toBe("true");
    expect(requestUrl.searchParams.get("marker")).toBe(
      localStorage.getItem(MARKER_KEY),
    );
    expect(init).toMatchObject({ credentials: "include" });
  });

  it("uses an existing marker, unwraps legacy response envelopes, and propagates server errors", async () => {
    localStorage.setItem(MARKER_KEY, "existing-marker");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ snapshot }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: "Store not found" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHomepageSnapshot()).resolves.toEqual(snapshot);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("marker")).toBe(
      "existing-marker",
    );

    await expect(getHomepageSnapshot()).rejects.toThrow("Store not found");
  });
});
