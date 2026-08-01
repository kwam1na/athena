import { useLayoutEffect, useRef, type ReactNode } from "react";
import { animate, cubicBezier } from "animejs";
import { useReducedMotion } from "framer-motion";

import { cn } from "@/lib/utils";

const HEIGHT_TRANSITION_DURATION_MS = 240;
const heightTransitionEase = cubicBezier(0.22, 1, 0.36, 1);
const MEASUREMENT_TOLERANCE_PX = 0.5;

/**
 * Smooths intrinsic content-height changes without delaying the DOM update.
 *
 * The first measurement and width-driven reflows remain immediate. Subsequent
 * content-height changes animate an overflow-clipped outer wrapper and can be
 * interrupted safely from their currently rendered height.
 */
export function AnimatedHeight({
  animateFromZero = false,
  children,
  className,
  enabled = true,
  testId,
}: {
  animateFromZero?: boolean;
  children: ReactNode;
  className?: string;
  enabled?: boolean;
  testId?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  const shouldReduceMotion = Boolean(useReducedMotion());

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content || typeof ResizeObserver === "undefined") {
      return;
    }

    let hasMeasured = false;
    let previousHeight = 0;
    let previousWidth = 0;

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;

      const nextHeight = entry.contentRect.height;
      const nextWidth = entry.contentRect.width;

      if (!hasMeasured) {
        hasMeasured = true;
        previousHeight = nextHeight;
        previousWidth = nextWidth;
        wrapper.style.height = `${nextHeight}px`;
        return;
      }

      const heightChanged =
        Math.abs(nextHeight - previousHeight) > MEASUREMENT_TOLERANCE_PX;
      const widthChanged =
        Math.abs(nextWidth - previousWidth) > MEASUREMENT_TOLERANCE_PX;
      previousHeight = nextHeight;
      previousWidth = nextWidth;

      if (!heightChanged) return;

      const renderedHeight = wrapper.getBoundingClientRect().height;
      animationRef.current?.cancel();
      animationRef.current = null;

      if (!enabled || shouldReduceMotion || widthChanged) {
        wrapper.style.height = `${nextHeight}px`;
        return;
      }

      wrapper.style.height = `${
        renderedHeight > 0 || animateFromZero ? renderedHeight : nextHeight
      }px`;
      animationRef.current = animate(wrapper, {
        duration: HEIGHT_TRANSITION_DURATION_MS,
        ease: heightTransitionEase,
        height: `${nextHeight}px`,
        onComplete: () => {
          wrapper.style.height = `${nextHeight}px`;
          animationRef.current = null;
        },
      });
    });

    observer.observe(content);

    return () => {
      observer.disconnect();
      animationRef.current?.cancel();
      animationRef.current = null;
    };
  }, [animateFromZero, enabled, shouldReduceMotion]);

  return (
    <div
      className={cn("overflow-hidden", className)}
      data-motion="height"
      data-testid={testId}
      ref={wrapperRef}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
}
