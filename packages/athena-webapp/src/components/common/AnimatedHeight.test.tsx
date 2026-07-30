import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cancelAnimation = vi.fn();
const animate = vi.fn((...args: unknown[]) => {
  void args;
  return { cancel: cancelAnimation };
});
const useReducedMotion = vi.fn(() => false);
let resizeCallback:
  | ((
      entries: Array<{ contentRect: { height: number; width: number } }>,
    ) => void)
  | undefined;

vi.mock("animejs", () => ({
  animate: (...args: unknown[]) => animate(...args),
  cubicBezier: vi.fn(() => "ease"),
}));
vi.mock("framer-motion", () => ({
  useReducedMotion: () => useReducedMotion(),
}));

import { AnimatedHeight } from "./AnimatedHeight";

describe("AnimatedHeight", () => {
  beforeEach(() => {
    animate.mockClear();
    cancelAnimation.mockClear();
    useReducedMotion.mockReturnValue(false);
    resizeCallback = undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        constructor(callback: typeof resizeCallback) {
          resizeCallback = callback;
        }

        observe() {}
        disconnect() {}
      },
    );
  });

  it("renders the first measured height immediately, then animates changes", () => {
    render(
      <AnimatedHeight testId="animated-height">
        <div>Rows</div>
      </AnimatedHeight>,
    );

    const wrapper = screen.getByTestId("animated-height");
    Object.defineProperty(wrapper, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ height: 100 }),
    });

    resizeCallback?.([{ contentRect: { height: 100, width: 400 } }]);
    expect(wrapper).toHaveStyle({ height: "100px" });
    expect(animate).not.toHaveBeenCalled();

    resizeCallback?.([{ contentRect: { height: 180, width: 400 } }]);
    expect(animate).toHaveBeenCalledWith(
      wrapper,
      expect.objectContaining({
        duration: 240,
        height: "180px",
      }),
    );
  });

  it("updates immediately when motion is disabled", () => {
    render(
      <AnimatedHeight enabled={false} testId="animated-height">
        <div>Rows</div>
      </AnimatedHeight>,
    );

    const wrapper = screen.getByTestId("animated-height");
    resizeCallback?.([{ contentRect: { height: 120, width: 400 } }]);
    resizeCallback?.([{ contentRect: { height: 240, width: 400 } }]);

    expect(wrapper).toHaveStyle({ height: "240px" });
    expect(animate).not.toHaveBeenCalled();
  });

  it("updates immediately when reduced motion is preferred", () => {
    useReducedMotion.mockReturnValue(true);
    render(
      <AnimatedHeight testId="animated-height">
        <div>Rows</div>
      </AnimatedHeight>,
    );

    const wrapper = screen.getByTestId("animated-height");
    resizeCallback?.([{ contentRect: { height: 120, width: 400 } }]);
    resizeCallback?.([{ contentRect: { height: 240, width: 400 } }]);

    expect(wrapper).toHaveStyle({ height: "240px" });
    expect(animate).not.toHaveBeenCalled();
  });

  it("interrupts an active transition before animating the next height", () => {
    render(
      <AnimatedHeight testId="animated-height">
        <div>Rows</div>
      </AnimatedHeight>,
    );

    const wrapper = screen.getByTestId("animated-height");
    Object.defineProperty(wrapper, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ height: 140 }),
    });

    resizeCallback?.([{ contentRect: { height: 100, width: 400 } }]);
    resizeCallback?.([{ contentRect: { height: 180, width: 400 } }]);
    resizeCallback?.([{ contentRect: { height: 240, width: 400 } }]);

    expect(cancelAnimation).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenLastCalledWith(
      wrapper,
      expect.objectContaining({ height: "240px" }),
    );
  });
});
