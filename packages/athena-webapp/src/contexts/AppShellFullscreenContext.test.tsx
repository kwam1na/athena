import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  AppShellFullscreenContext,
  useAppShellFullscreenMode,
} from "./AppShellFullscreenContext";

function renderWithProvider(setFullscreenOverride = vi.fn()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppShellFullscreenContext.Provider value={{ setFullscreenOverride }}>
      {children}
    </AppShellFullscreenContext.Provider>
  );

  renderHook(() => useAppShellFullscreenMode(), { wrapper });

  return { setFullscreenOverride };
}

/**
 * Dispatches a keydown whose `key` is absent, the way synthetic events from
 * barcode scanners and some IMEs arrive.
 */
function dispatchKeylessKeydown() {
  const event = new KeyboardEvent("keydown", { bubbles: true });
  Object.defineProperty(event, "key", { value: undefined });
  document.dispatchEvent(event);
}

describe("useAppShellFullscreenMode", () => {
  it("ignores keydown events that carry no key", () => {
    // This listener is attached document-wide on every POS screen, so an
    // unguarded `event.key.toLowerCase()` threw on ordinary barcode scans.
    //
    // The throw happens inside a DOM listener, so it never propagates out of
    // dispatchEvent — jsdom reports it as an uncaught error instead. Asserting
    // on that channel is the only way this test can actually see the bug.
    const uncaught: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      event.preventDefault();
      uncaught.push(event.error ?? event.message);
    };
    window.addEventListener("error", onError);

    try {
      const { setFullscreenOverride } = renderWithProvider();
      setFullscreenOverride.mockClear();

      dispatchKeylessKeydown();

      expect(uncaught).toEqual([]);
      expect(setFullscreenOverride).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("error", onError);
    }
  });

  it("still toggles fullscreen on a bare 'f'", () => {
    const { setFullscreenOverride } = renderWithProvider();
    setFullscreenOverride.mockClear();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "f" }),
    );

    expect(setFullscreenOverride).toHaveBeenCalledTimes(1);
  });

  it("ignores 'f' pressed with a modifier", () => {
    const { setFullscreenOverride } = renderWithProvider();
    setFullscreenOverride.mockClear();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "f", ctrlKey: true }),
    );

    expect(setFullscreenOverride).not.toHaveBeenCalled();
  });

  it("ignores 'f' typed into an input", () => {
    const { setFullscreenOverride } = renderWithProvider();
    setFullscreenOverride.mockClear();

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "f" }));
    input.remove();

    expect(setFullscreenOverride).not.toHaveBeenCalled();
  });
});
