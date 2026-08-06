import { useLayoutEffect, type RefObject } from "react";

/**
 * Preserve the scroll position of the page a sheet opened over.
 *
 * ## The problem
 *
 * Sheets are Radix dialogs (`components/ui/sheet`), so opening one mounts
 * `react-remove-scroll` and locks the body. That is fine on its own — but the
 * page underneath is still a live React tree, and anything that remounts it
 * while the sheet is open (a route replace, a settling query, a parent state
 * change) gives its inner `overflow-y:auto` container a fresh DOM node with
 * `scrollTop` back at 0. The sheet then closes onto a page scrolled to the top,
 * and whatever row the user opened is gone from view.
 *
 * ## The fix
 *
 * Record the scroll offset at the moment the sheet opens, then re-pin it before
 * paint on every render while the sheet stays open. A remount is re-pinned by
 * the same effect that pinned the first render, so the reset is never visible.
 *
 * ## Why the offset lives outside React
 *
 * In a module-level map rather than a ref, because the remount this exists to
 * survive can destroy the component holding the ref. Keyed by `contextKey` so
 * two sheets — or the same sheet over a different date range — never restore
 * each other's position. Entries are deleted on close; nothing accumulates.
 *
 * ## Capture timing is the caller's job
 *
 * `capture()` must run in the same handler that opens the sheet, BEFORE the
 * scroll lock applies. That is why it is returned rather than driven by an
 * effect on `isOpen`: by the time an effect observes the change, the lock has
 * already moved the page.
 */
const preservedScrollTops = new Map<string, number>();

/**
 * The nearest scrolling element at or above `element`.
 *
 * `element` ITSELF is considered first, so a caller holding a direct ref to
 * the scroll container works as naturally as one holding a ref to a trigger
 * inside it. That costs nothing for the trigger case — a button never
 * satisfies the test below.
 *
 * Both conditions matter. `overflowY` alone matches containers that declare
 * scrolling but have nothing to scroll, and an overflowing element with
 * `overflow:visible` scrolls its ancestor, not itself — so restoring onto
 * either would silently write to the wrong node.
 */
export function findScrollableAncestor(
  element: HTMLElement | null | undefined,
): HTMLElement | null {
  let candidate = element ?? null;
  while (
    candidate &&
    !(
      candidate.scrollHeight > candidate.clientHeight &&
      ["auto", "scroll"].includes(getComputedStyle(candidate).overflowY)
    )
  ) {
    candidate = candidate.parentElement;
  }
  return candidate;
}

export type SheetScrollPreservation = {
  /**
   * Record the current offset. Call this in the handler that OPENS the sheet —
   * an effect runs too late, once the scroll lock has already moved the page.
   */
  capture: () => void;
  /** Forget the recorded offset. Call when the sheet closes. */
  clear: () => void;
  /** The recorded offset, or `undefined` when nothing was captured. */
  peek: () => number | undefined;
  /**
   * Overwrite the recorded offset. For a caller that restores a position from
   * somewhere else (a route param, say) and needs this map to agree with it.
   */
  remember: (scrollTop: number) => void;
};

export function useSheetScrollPreservation(args: {
  /**
   * Any element INSIDE the scrolling region — normally the control that opens
   * the sheet. The scroll container is found by walking up from here, so a ref
   * to something outside the region will find the wrong node or none at all.
   */
  anchorRef: RefObject<HTMLElement | null>;
  contextKey: string;
  isOpen: boolean;
}): SheetScrollPreservation {
  const { anchorRef, contextKey, isOpen } = args;

  useLayoutEffect(() => {
    if (!isOpen) return;
    const scrollTop = preservedScrollTops.get(contextKey);
    const container = findScrollableAncestor(anchorRef.current);
    if (scrollTop === undefined || !container) return;
    container.scrollTop = scrollTop;
    // Deliberately layout, not passive: the reset has to be corrected before
    // the browser paints, or the page visibly jumps to the top and back.
  }, [anchorRef, contextKey, isOpen]);

  return {
    capture: () => {
      const container = findScrollableAncestor(anchorRef.current);
      if (!container) return;
      preservedScrollTops.set(contextKey, container.scrollTop);
    },
    clear: () => {
      preservedScrollTops.delete(contextKey);
    },
    peek: () => preservedScrollTops.get(contextKey),
    remember: (scrollTop: number) => {
      preservedScrollTops.set(contextKey, scrollTop);
    },
  };
}
