import { describe, expect, it } from "vitest";

import {
  computeScrollProgress,
  scrollToTopDurationMs,
} from "./scrollProgress";

describe("computeScrollProgress", () => {
  it("reports the fraction of the scrollable distance travelled", () => {
    // 4000 tall in a 1000 viewport leaves 3000 scrollable.
    expect(computeScrollProgress(0, 4000, 1000)).toBe(0);
    expect(computeScrollProgress(1500, 4000, 1000)).toBe(0.5);
    expect(computeScrollProgress(3000, 4000, 1000)).toBe(1);
  });

  it("reports 0 when the page cannot scroll", () => {
    expect(computeScrollProgress(0, 800, 800)).toBe(0);
    expect(computeScrollProgress(0, 600, 900)).toBe(0);
  });

  it("clamps overscroll in both directions", () => {
    // Rubber-band scrolling reports values outside the real range.
    expect(computeScrollProgress(-120, 4000, 1000)).toBe(0);
    expect(computeScrollProgress(4200, 4000, 1000)).toBe(1);
  });

  it("survives non-finite measurements", () => {
    expect(computeScrollProgress(Number.NaN, 4000, 1000)).toBe(0);
    expect(computeScrollProgress(100, Number.POSITIVE_INFINITY, 1000)).toBe(0);
  });
});

describe("scrollToTopDurationMs", () => {
  it("keeps a short hop snappy", () => {
    expect(scrollToTopDurationMs(0)).toBe(320);
    expect(scrollToTopDurationMs(400)).toBe(352);
  });

  it("scales with distance so a long page reads as travel", () => {
    expect(scrollToTopDurationMs(2000)).toBe(480);
  });

  it("caps so a very long page never stalls", () => {
    expect(scrollToTopDurationMs(20000)).toBe(640);
    expect(scrollToTopDurationMs(1_000_000)).toBe(640);
  });

  it("treats a negative distance as zero", () => {
    expect(scrollToTopDurationMs(-500)).toBe(320);
  });
});
