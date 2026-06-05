import { afterEach, describe, expect, it, vi } from "vitest";

import { removeConvexAuthCodeParamFromUrl } from "./convexAuthUrl";

describe("removeConvexAuthCodeParamFromUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes code query params before Convex Auth can auto-consume them", () => {
    const replaceState = vi.fn();
    const win = {
      history: {
        replaceState,
        state: { retained: true },
      },
      location: {
        href:
          "https://athena.example.com/wigclub/store/wigclub/pos?code=123456&o=%2Fhome#cart",
      },
    } as unknown as Window;

    const removed = removeConvexAuthCodeParamFromUrl(win);

    expect(removed).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(
      { retained: true },
      "",
      "/wigclub/store/wigclub/pos?o=%2Fhome#cart",
    );
  });

  it("leaves URLs alone when there is no code query param", () => {
    const replaceState = vi.fn();
    const win = {
      history: {
        replaceState,
        state: null,
      },
      location: {
        href: "https://athena.example.com/wigclub/store/wigclub/pos?o=%2Fhome",
      },
    } as unknown as Window;

    const removed = removeConvexAuthCodeParamFromUrl(win);

    expect(removed).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });
});
