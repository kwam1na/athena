import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useIsMobile } from "./use-mobile";

type MediaQueryListener = (event: MediaQueryListEvent) => void;

const mediaQueryListeners = new Set<MediaQueryListener>();
const originalInnerWidth = window.innerWidth;
const originalMatchMedia = window.matchMedia;

function notifyViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });

  const matches = width < 1024;
  const event = {
    matches,
    media: "(max-width: 1023px)",
  } as MediaQueryListEvent;

  mediaQueryListeners.forEach((listener) => listener(event));
}

beforeEach(() => {
  mediaQueryListeners.clear();
  window.matchMedia = ((query: string) =>
    ({
      matches: window.innerWidth < 1024,
      media: query,
      onchange: null,
      addEventListener: (_eventName: string, listener: MediaQueryListener) => {
        mediaQueryListeners.add(listener);
      },
      removeEventListener: (
        _eventName: string,
        listener: MediaQueryListener,
      ) => {
        mediaQueryListeners.delete(listener);
      },
      addListener: (listener: MediaQueryListener) => {
        mediaQueryListeners.add(listener);
      },
      removeListener: (listener: MediaQueryListener) => {
        mediaQueryListeners.delete(listener);
      },
      dispatchEvent: () => true,
    }) as MediaQueryList);
});

afterEach(() => {
  mediaQueryListeners.clear();
  window.matchMedia = originalMatchMedia;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: originalInnerWidth,
  });
});

describe("useIsMobile", () => {
  it("treats tablet widths below 1024px as mobile", () => {
    notifyViewportWidth(820);

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
  });

  it("treats 1024px and above as desktop shell widths", () => {
    notifyViewportWidth(1024);

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);
  });

  it("updates when the viewport crosses the 1024px breakpoint", () => {
    notifyViewportWidth(1000);

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);

    act(() => {
      notifyViewportWidth(1200);
    });

    expect(result.current).toBe(false);
  });
});
