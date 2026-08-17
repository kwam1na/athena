import { beforeEach, describe, expect, it } from "vitest";

import { MARKER_KEY } from "@/lib/constants";
import { getOrCreateGuestMarker } from "./guestMarker";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("getOrCreateGuestMarker", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("mints a UUID marker and persists it", () => {
    const marker = getOrCreateGuestMarker();

    expect(marker).toMatch(UUID);
    expect(localStorage.getItem(MARKER_KEY)).toBe(marker);
    expect(getOrCreateGuestMarker()).toBe(marker);
  });

  it("replaces a stored low-entropy marker instead of sending it", () => {
    // The shape older builds minted with `Math.random().toString(36)`: the
    // server refuses to look it up, so keeping it would strand this browser
    // sending a marker that can never recover anything.
    localStorage.setItem(MARKER_KEY, "k3j9x");

    const marker = getOrCreateGuestMarker();

    expect(marker).not.toBe("k3j9x");
    expect(marker).toMatch(UUID);
    expect(localStorage.getItem(MARKER_KEY)).toBe(marker);
  });
});
