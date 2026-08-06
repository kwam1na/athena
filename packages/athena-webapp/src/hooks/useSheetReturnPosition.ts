import { useEffect, useRef, type RefObject } from "react";

import {
  findScrollableAncestor,
  type SheetScrollPreservation,
} from "./useSheetScrollPreservation";

/**
 * Return a visitor to where they were after a sheet sends them somewhere else.
 *
 * Most sheets in this app are a stop on the way to somewhere: a row opens a
 * sheet, a link inside it navigates to a detail page, and coming back should
 * land on the same scroll offset with focus on the link that was followed —
 * not at the top of the page with focus on `<body>`.
 *
 * ## What is generic and what is not
 *
 * The machinery here is generic: one-shot bookkeeping so each leg runs at most
 * once per open, a bounded animation-frame retry while the returned page lays
 * out, a `MutationObserver` for content that mounts asynchronously, and a
 * completion gate that fires only once BOTH requested legs are done — so the
 * caller can clear its return keys without cancelling a leg still in flight.
 *
 * Every judgement stays with the caller, because only it can make them: which
 * element identifies the return target, whether that target is still expected
 * to exist, when its own content has settled, and what to do when the target
 * is genuinely gone. A hook that guessed at those would restore focus to the
 * wrong row — worse than not restoring it.
 *
 * ## Why the legs are gated on each other
 *
 * The caller clears its return keys in `onComplete`. Firing that after the
 * scroll leg while the focus leg is still waiting for content would delete the
 * key the focus leg needs. So completion waits for every leg that was asked
 * for, and fires exactly once.
 */

/** Frames to wait for a scroll container to become tall enough to scroll. */
const SCROLL_RETRY_FRAME_BUDGET = 30;

export type SheetReturnFocus = {
  /**
   * CSS selector for the element to focus. Build it with `CSS.escape` — the
   * identifier usually comes from a URL and cannot be trusted as selector
   * syntax.
   */
  selector: string;
  /**
   * Whether the target is still expected in the settled content. When true, a
   * missing element means "not rendered YET" and the observer keeps waiting;
   * when false it means "genuinely gone" and `onMissing` runs immediately.
   * Distinguishing these is why the caller supplies it: an elapsed frame
   * budget is not evidence that a row was removed.
   */
  isExpected: boolean;
  /** The caller's content has settled and the target would be rendered by now. */
  isReady: boolean;
  /**
   * No content will ever settle (an error or unavailable state). The leg gives
   * the keys back without moving focus, rather than waiting forever.
   */
  isUnavailable?: boolean;
  /** The target is gone. Move focus somewhere sensible and say so. */
  onMissing?: () => void;
  /**
   * Subtree the target is looked up and watched within. Defaults to the open
   * dialog, which is where a sheet's own content lives — and scoping matters
   * beyond performance: the same key is often also rendered on the page behind
   * the sheet, and an unscoped lookup would focus that copy instead.
   */
  observeWithinSelector?: string;
};

export function useSheetReturnPosition(args: {
  /** An element inside the scrolling region the offset belongs to. */
  anchorRef: RefObject<HTMLElement | null>;
  focus?: SheetReturnFocus;
  isOpen: boolean;
  /**
   * An outbound navigation from this sheet is still in flight. Both legs pause:
   * consuming a return token mid-departure would restore the position the
   * visitor is in the act of leaving.
   */
  isNavigationPending?: boolean;
  /** Fired once, after every requested leg finishes. */
  onComplete?: () => void;
  /** Keeps the in-mount map coherent, so closing later does not jump to top. */
  preservation?: SheetScrollPreservation;
  /** Page offset to return to. */
  scrollOffset?: number;
}): void {
  const {
    anchorRef,
    focus,
    isOpen,
    isNavigationPending,
    onComplete,
    preservation,
    scrollOffset,
  } = args;

  const legs = useRef({ completed: false, focusDone: false, scrollDone: false });

  // Re-arm on close so the next open restores again rather than reading a
  // previous visit's finished bookkeeping.
  useEffect(() => {
    if (isOpen) return;
    legs.current = { completed: false, focusDone: false, scrollDone: false };
  }, [isOpen]);

  const wantsScroll = scrollOffset !== undefined;
  const wantsFocus = focus !== undefined;

  const completeIfReady = () => {
    const current = legs.current;
    if (current.completed) return;
    if (wantsScroll && !current.scrollDone) return;
    if (wantsFocus && !current.focusDone) return;
    if (!wantsScroll && !wantsFocus) return;
    current.completed = true;
    onComplete?.();
  };

  useEffect(() => {
    if (!isOpen || scrollOffset === undefined || isNavigationPending) return;
    const current = legs.current;
    if (current.scrollDone || current.completed) return;
    // A zero or nonsense offset has nothing to restore, but the leg still has
    // to report done or completion would never fire.
    if (!Number.isFinite(scrollOffset) || scrollOffset <= 0) {
      current.scrollDone = true;
      completeIfReady();
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const attempt = () => {
      if (cancelled) return;
      const container = findScrollableAncestor(anchorRef.current);
      if (container && container.scrollHeight > container.clientHeight) {
        container.scrollTop = scrollOffset;
        preservation?.remember(scrollOffset);
        current.scrollDone = true;
        completeIfReady();
        return;
      }
      attempts += 1;
      if (attempts >= SCROLL_RETRY_FRAME_BUDGET) {
        // Degrade to the top rather than hold the keys hostage: the page may
        // simply be shorter than it was when the offset was captured.
        current.scrollDone = true;
        completeIfReady();
        return;
      }
      requestAnimationFrame(attempt);
    };
    attempt();
    return () => {
      cancelled = true;
    };
    // completeIfReady closes over the same values this effect lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorRef, isNavigationPending, isOpen, preservation, scrollOffset]);

  const isUnavailable = focus?.isUnavailable ?? false;
  const isReady = focus?.isReady ?? false;
  const isExpected = focus?.isExpected ?? false;
  const selector = focus?.selector;
  const observeWithinSelector = focus?.observeWithinSelector ?? "[role='dialog']";
  const onMissing = focus?.onMissing;

  useEffect(() => {
    if (!isOpen || selector === undefined || isNavigationPending) return;
    const current = legs.current;
    if (current.focusDone || current.completed) return;
    if (isUnavailable) {
      current.focusDone = true;
      completeIfReady();
      return;
    }
    if (!isReady) return;

    const attemptFocus = (): boolean => {
      if (current.focusDone || current.completed) return true;
      // Scoped to the sheet, never the document. The same key is often
      // rendered twice — a row inside the sheet and a preview of that row on
      // the page behind it — and a document-wide lookup silently focuses
      // whichever comes first in document order, which is the copy the
      // visitor never touched.
      const root = document.querySelector(observeWithinSelector) ?? document;
      const target = root.querySelector<HTMLElement>(selector);
      // Absent but still expected means "not mounted yet" — keep waiting.
      if (!target && isExpected) return false;
      current.focusDone = true;
      if (target) target.focus();
      else onMissing?.();
      completeIfReady();
      return true;
    };

    let observer: MutationObserver | undefined;
    const frame = requestAnimationFrame(() => {
      if (attemptFocus()) return;
      // Content can mount asynchronously after the frame the page settled on
      // (chart axes are the usual case). The caller told us the target is
      // still expected, so watch for it rather than calling it removed.
      observer = new MutationObserver(() => {
        if (attemptFocus()) observer?.disconnect();
      });
      const within = document.querySelector(observeWithinSelector);
      observer.observe(within ?? document.body, {
        childList: true,
        subtree: true,
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
    // completeIfReady closes over the same values this effect lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isExpected,
    isNavigationPending,
    isOpen,
    isReady,
    isUnavailable,
    observeWithinSelector,
    onMissing,
    selector,
  ]);
}
