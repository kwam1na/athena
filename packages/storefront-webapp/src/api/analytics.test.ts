import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config", () => ({
  default: {
    apiGateway: {
      URL: "https://athena.example",
    },
  },
}));

import { postAnalytics } from "./analytics";

describe("postAnalytics", () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.navigator = originalNavigator;
    fetchMock.mockReset();
  });

  it("lets browser automation force the reserved synthetic origin", async () => {
    vi.stubGlobal("window", {
      location: {
        search: "?origin=synthetic_monitor",
      },
    });
    vi.stubGlobal("navigator", { webdriver: true });

    await postAnalytics({
      action: "clicked_on_discount_code_trigger",
      origin: "homepage",
      data: {},
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://athena.example/analytics",
      expect.objectContaining({
        body: JSON.stringify({
          action: "clicked_on_discount_code_trigger",
          origin: "synthetic_monitor",
          data: {},
          productId: undefined,
        }),
      }),
    );
  });

  it("ignores synthetic query params outside browser automation", async () => {
    vi.stubGlobal("window", {
      location: {
        search: "?origin=synthetic_monitor&utm_source=campaign",
      },
    });
    vi.stubGlobal("navigator", { webdriver: false });

    await postAnalytics({
      action: "clicked_on_discount_code_trigger",
      origin: "homepage",
      data: {},
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://athena.example/analytics",
      expect.objectContaining({
        body: JSON.stringify({
          action: "clicked_on_discount_code_trigger",
          origin: "homepage",
          data: {},
          productId: undefined,
        }),
      }),
    );
  });
});
