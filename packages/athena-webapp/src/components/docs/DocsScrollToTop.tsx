import { useEffect, useRef, useState } from "react";
import { animate, cubicBezier } from "animejs";
import { useReducedMotion } from "framer-motion";
import { ArrowUp } from "lucide-react";

import {
  computeScrollProgress,
  SCROLL_TO_TOP_REVEAL_PX,
  scrollToTopDurationMs,
} from "@/lib/docs/scrollProgress";

import "./docs-scroll-to-top.css";

// The app's own --ease-standard. Strong ease-out: it leaves immediately, which
// is the part of the travel the reader is watching, then settles.
const scrollEase = cubicBezier(0.22, 1, 0.36, 1);

/**
 * Floating control that reports reading progress in its ring and returns the
 * reader to the top of the page.
 *
 * Scroll progress is written straight to the ring's `stroke-dashoffset` rather
 * than held in React state: it changes every frame, and re-rendering the tree
 * on each one would be wasted work. Only the visibility boolean — which flips
 * rarely — goes through state, so focus handling stays declarative.
 */
export function DocsScrollToTop() {
  const progressRef = useRef<SVGCircleElement | null>(null);
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  const isVisibleRef = useRef(false);
  const [isVisible, setIsVisible] = useState(false);
  const shouldReduceMotion = Boolean(useReducedMotion());

  useEffect(() => {
    let frame = 0;

    const read = () => {
      frame = 0;
      const root = document.documentElement;
      const scrollTop = window.scrollY;
      const progress = computeScrollProgress(
        scrollTop,
        root.scrollHeight,
        root.clientHeight,
      );

      const ring = progressRef.current;
      if (ring) {
        ring.style.strokeDashoffset = String(1 - progress);
      }

      const nextVisible = scrollTop > SCROLL_TO_TOP_REVEAL_PX;
      if (nextVisible !== isVisibleRef.current) {
        isVisibleRef.current = nextVisible;
        setIsVisible(nextVisible);
      }
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(read);
    };

    read();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    // Page content swaps as the reader navigates, so the scrollable distance
    // changes without a scroll or resize event to announce it.
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(document.body);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, []);

  // Any real scroll input while the animation runs hands control straight back
  // to the reader instead of fighting them for the viewport.
  useEffect(() => {
    const cancel = () => {
      animationRef.current?.cancel();
      animationRef.current = null;
    };
    const events = ["wheel", "touchstart", "pointerdown"] as const;
    for (const event of events) {
      window.addEventListener(event, cancel, { passive: true });
    }
    return () => {
      for (const event of events) {
        window.removeEventListener(event, cancel);
      }
      cancel();
    };
  }, []);

  const handleClick = () => {
    const from = window.scrollY;
    if (from <= 0) return;

    if (shouldReduceMotion) {
      window.scrollTo(0, 0);
      return;
    }

    animationRef.current?.cancel();
    // Animating a plain object and writing each frame to the scroll position
    // keeps the travel interruptible; `scroll-behavior: smooth` could not be
    // cancelled partway.
    const state = { y: from };
    animationRef.current = animate(state, {
      y: 0,
      duration: scrollToTopDurationMs(from),
      ease: scrollEase,
      onUpdate: () => {
        window.scrollTo(0, state.y);
      },
      onComplete: () => {
        animationRef.current = null;
      },
    });
  };

  return (
    <button
      type="button"
      aria-label="Scroll to top"
      aria-hidden={!isVisible}
      tabIndex={isVisible ? 0 : -1}
      data-visible={isVisible}
      className="docs-scroll-top"
      onClick={handleClick}
    >
      <svg
        className="docs-scroll-top__ring"
        viewBox="0 0 44 44"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          className="docs-scroll-top__track"
          cx="22"
          cy="22"
          r="19"
          fill="none"
          strokeWidth="2"
        />
        <circle
          ref={progressRef}
          className="docs-scroll-top__progress"
          cx="22"
          cy="22"
          r="19"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          pathLength={1}
          strokeDashoffset={1}
        />
      </svg>
      <ArrowUp className="docs-scroll-top__glyph h-4 w-4" aria-hidden="true" />
    </button>
  );
}

export default DocsScrollToTop;
