// Pure scroll math for the docs scroll-to-top control, kept out of the
// component so the edge cases can be tested without a layout engine.

/** Reveal the control once the reader is roughly half a laptop viewport down. */
export const SCROLL_TO_TOP_REVEAL_PX = 400;

const MIN_SCROLL_DURATION_MS = 320;
const MAX_SCROLL_DURATION_MS = 640;
const MS_PER_PIXEL = 0.08;

/**
 * Fraction of the scrollable distance already travelled, clamped to 0–1.
 * A page with nothing to scroll reports 0 rather than dividing by zero.
 */
export function computeScrollProgress(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const scrollable = scrollHeight - clientHeight;
  if (!Number.isFinite(scrollable) || scrollable <= 0) return 0;
  const progress = scrollTop / scrollable;
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

/**
 * Scaled so a short hop stays snappy while a long page still reads as a
 * traversal rather than a jump cut. A fixed UI-length duration would blur a
 * 4,000px page; an unbounded one would stall on a very long one.
 */
export function scrollToTopDurationMs(distancePx: number): number {
  const distance = Math.max(0, distancePx);
  const scaled = MIN_SCROLL_DURATION_MS + distance * MS_PER_PIXEL;
  return Math.min(MAX_SCROLL_DURATION_MS, scaled);
}
