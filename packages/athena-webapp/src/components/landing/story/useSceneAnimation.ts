import { useEffect, useRef } from "react";
import { animate } from "animejs";
import { useReducedMotion } from "framer-motion";

// Scenes render their finished composition in JSX; a scene's `build` callback
// animates elements *from* their initial states when the scene scrolls into
// view. With reduced motion (or without IntersectionObserver, e.g. jsdom) the
// build never runs and the static final frame is what the visitor sees.
export function useSceneAnimation(
  build: (root: HTMLElement) => (() => void) | void,
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const hasPlayedRef = useRef(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || reducedMotion || hasPlayedRef.current) return;
    if (typeof IntersectionObserver === "undefined") return;

    let cleanup: (() => void) | void;
    const observer = new IntersectionObserver(
      (entries) => {
        if (hasPlayedRef.current) return;
        if (!entries.some((entry) => entry.isIntersecting)) return;
        hasPlayedRef.current = true;
        observer.disconnect();
        cleanup = build(root);
      },
      { threshold: 0.35 },
    );
    observer.observe(root);
    return () => {
      observer.disconnect();
      if (cleanup) cleanup();
    };
  }, [build, reducedMotion]);

  return rootRef;
}

// Count-up helper for numeric readouts: animates a plain object and writes the
// formatted value into the element on every frame.
export function animateAmount(
  element: Element | null,
  args: {
    delay?: number;
    duration?: number;
    format: (value: number) => string;
    to: number;
  },
) {
  if (!element) return;
  const counter = { value: 0 };
  animate(counter, {
    delay: args.delay ?? 0,
    duration: args.duration ?? 900,
    ease: "outCubic",
    onUpdate: () => {
      element.textContent = args.format(counter.value);
    },
    value: args.to,
  });
}
