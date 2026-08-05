import { useCallback, useLayoutEffect, useRef } from "react";
import { animate, cubicBezier, stagger, utils } from "animejs";
import { useReducedMotion } from "framer-motion";

import { cn } from "@/lib/utils";

const FLIP_TRANSITION_DELAY_MS = 120;
const FLIP_TRANSITION_DURATION_MS = 650;
const FLIP_TRANSITION_EASING = "ease";
const flipTransitionEase = cubicBezier(0.25, 0.1, 0.25, 1);
const FLIP_GLYPH_STAGGER_MS = 12;
const FLIP_OUT_DURATION_MS = 200;
const FLIP_IN_DURATION_MS = 280;
const ZERO_FADE_DURATION_MS = 180;
const TEXT_FLIP_TRANSITION_DURATION_MS =
  FLIP_OUT_DURATION_MS + FLIP_IN_DURATION_MS;

export type FlipNumberZeroTransition = "fade" | "flip" | "instant";

function defaultFormatValue(value: number): string {
  return value.toLocaleString();
}

function renderFlipGlyphs(element: HTMLElement, value: string): HTMLElement[] {
  const glyphs = Array.from(value, (character) => {
    const glyph = document.createElement("span");
    glyph.className =
      "inline-block [backface-visibility:hidden] [transform-style:preserve-3d]";
    glyph.dataset.flipGlyph = "";
    glyph.textContent = character;
    return glyph;
  });
  element.replaceChildren(...glyphs);
  return glyphs;
}

function renderFlipText(element: HTMLElement, value: string): HTMLElement {
  const text = document.createElement("span");
  text.className =
    "inline-block min-w-0 [backface-visibility:hidden] [transform-style:preserve-3d]";
  text.textContent = value;
  element.replaceChildren(text);
  return text;
}

/** A whole-string variant of the FlipNumber transition. */
export function FlipText({
  accessible = true,
  animateChanges = true,
  className,
  delayMs = 0,
  onTransitionComplete,
  reduceMotion,
  testId,
  value,
}: {
  accessible?: boolean;
  animateChanges?: boolean;
  className?: string;
  /** Keeps the current string visible before the next transition begins. */
  delayMs?: number;
  /** Fires when the current visible string has fully settled. */
  onTransitionComplete?: (value: string) => void;
  reduceMotion?: boolean;
  testId?: string;
  value: string;
}) {
  const prefersReducedMotion = useReducedMotion();
  const shouldReduceMotion = reduceMotion ?? Boolean(prefersReducedMotion);
  const resolvedDelayMs = Math.max(0, delayMs);
  const valueRef = useRef<HTMLSpanElement | null>(null);
  const displayedValueRef = useRef(value);
  const onTransitionCompleteRef = useRef(onTransitionComplete);
  onTransitionCompleteRef.current = onTransitionComplete;
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  const assignValueRef = useCallback((element: HTMLSpanElement | null) => {
    valueRef.current = element;
    if (element && element.childElementCount === 0) {
      renderFlipText(element, displayedValueRef.current);
    }
  }, []);

  useLayoutEffect(() => {
    const element = valueRef.current;
    if (!element) return;

    const previousValue = displayedValueRef.current;
    animationRef.current?.revert();
    animationRef.current = null;

    if (previousValue === value) {
      if (element.childElementCount === 0) renderFlipText(element, value);

      const completionFrame = requestAnimationFrame(() => {
        onTransitionCompleteRef.current?.(value);
      });
      return () => cancelAnimationFrame(completionFrame);
    }

    if (!animateChanges) {
      displayedValueRef.current = value;
      renderFlipText(element, value);
      const completionFrame = requestAnimationFrame(() => {
        onTransitionCompleteRef.current?.(value);
      });
      return () => cancelAnimationFrame(completionFrame);
    }

    if (shouldReduceMotion) {
      displayedValueRef.current = value;
      const incoming = renderFlipText(element, value);
      utils.set(incoming, { opacity: 0 });
      animationRef.current = animate(incoming, {
        delay: resolvedDelayMs,
        duration: 120,
        ease: flipTransitionEase,
        opacity: 1,
        onComplete: () => {
          incoming.removeAttribute("style");
          animationRef.current = null;
          onTransitionCompleteRef.current?.(value);
        },
      });
      return () => {
        animationRef.current?.revert();
      };
    }

    const outgoing =
      (element.firstElementChild as HTMLElement | null) ??
      renderFlipText(element, previousValue);
    animationRef.current = animate(outgoing, {
      delay: resolvedDelayMs,
      duration: FLIP_OUT_DURATION_MS,
      ease: flipTransitionEase,
      filter: "blur(1px)",
      opacity: 0,
      rotateX: "55deg",
      translateY: "-55%",
      onComplete: () => {
        displayedValueRef.current = value;
        const incoming = renderFlipText(element, value);
        utils.set(incoming, {
          filter: "blur(1px)",
          opacity: 0,
          rotateX: "-55deg",
          translateY: "55%",
        });
        animationRef.current = animate(incoming, {
          duration: FLIP_IN_DURATION_MS,
          ease: flipTransitionEase,
          filter: "blur(0px)",
          opacity: 1,
          rotateX: "0deg",
          translateY: "0%",
          onComplete: () => {
            incoming.removeAttribute("style");
            animationRef.current = null;
            onTransitionCompleteRef.current?.(value);
          },
        });
      },
    });

    return () => {
      animationRef.current?.revert();
    };
  }, [animateChanges, resolvedDelayMs, shouldReduceMotion, value]);

  return (
    <span
      aria-hidden={accessible ? undefined : true}
      className={cn(
        "inline-flex max-w-full overflow-hidden [perspective:8rem]",
        className,
      )}
      data-motion="flip"
      data-switch-delay={resolvedDelayMs}
      data-testid={testId}
      data-transition-duration={TEXT_FLIP_TRANSITION_DURATION_MS}
      data-transition-easing={FLIP_TRANSITION_EASING}
      data-value={value}
      data-variant="text"
    >
      {accessible ? <span className="sr-only">{value}</span> : null}
      <span
        aria-hidden={accessible ? true : undefined}
        className="inline-flex min-w-0"
        ref={assignValueRef}
      />
    </span>
  );
}

/**
 * A reusable, accessible number transition.
 *
 * The first value renders immediately; subsequent values flip glyph by glyph.
 * Consumers that already provide equivalent accessible copy can set
 * `accessible={false}` to make this instance purely decorative.
 */
export function FlipNumber({
  accessible = true,
  animateChanges = true,
  className,
  formatValue = defaultFormatValue,
  reduceMotion,
  skipAnimationFromZero = false,
  testId,
  transitionFromZero,
  value,
}: {
  accessible?: boolean;
  animateChanges?: boolean;
  className?: string;
  formatValue?: (value: number) => string;
  reduceMotion?: boolean;
  /** @deprecated Use transitionFromZero="instant" instead. */
  skipAnimationFromZero?: boolean;
  testId?: string;
  transitionFromZero?: FlipNumberZeroTransition;
  value: number;
}) {
  const prefersReducedMotion = useReducedMotion();
  const shouldReduceMotion = reduceMotion ?? Boolean(prefersReducedMotion);
  const formattedValue = formatValue(value);
  /**
   * `fade`, not `flip`, is the default.
   *
   * Almost every consumer mounts before its data arrives — `value={total ?? 0}`
   * is the house pattern — so the metric mounts at a placeholder zero and the
   * real figure is its FIRST change. Flipping there animates the *arrival of
   * data* as though the number had moved, which is why a freshly loaded page
   * churns through every metric at once. A change between two real values
   * still flips; only the settle out of zero is calmed.
   *
   * Pass `transitionFromZero="flip"` explicitly where a zero is a genuine
   * reading the user watched, rather than "not loaded yet".
   */
  const resolvedZeroTransition =
    transitionFromZero ?? (skipAnimationFromZero ? "instant" : "fade");
  const valueRef = useRef<HTMLSpanElement | null>(null);
  const displayedValueRef = useRef(formattedValue);
  const displayedNumberRef = useRef(value);
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);

  useLayoutEffect(() => {
    const element = valueRef.current;
    if (!element) return;

    const previousValue = displayedValueRef.current;
    const previousNumber = displayedNumberRef.current;
    animationRef.current?.revert();
    animationRef.current = null;

    if (previousValue === formattedValue) {
      if (element.childElementCount === 0) {
        renderFlipGlyphs(element, formattedValue);
      }
      return;
    }

    if (!animateChanges) {
      displayedValueRef.current = formattedValue;
      displayedNumberRef.current = value;
      renderFlipGlyphs(element, formattedValue);
      return;
    }

    if (previousNumber === 0 && resolvedZeroTransition !== "flip") {
      displayedValueRef.current = formattedValue;
      displayedNumberRef.current = value;
      const incomingGlyphs = renderFlipGlyphs(element, formattedValue);

      if (resolvedZeroTransition === "instant") {
        return;
      }

      utils.set(incomingGlyphs, { opacity: 0 });
      animationRef.current = animate(incomingGlyphs, {
        duration: ZERO_FADE_DURATION_MS,
        ease: flipTransitionEase,
        opacity: 1,
        onComplete: () => {
          incomingGlyphs.forEach((glyph) => glyph.removeAttribute("style"));
          animationRef.current = null;
        },
      });
      return () => {
        animationRef.current?.revert();
      };
    }

    const outgoingGlyphs =
      element.childElementCount > 0
        ? (Array.from(element.children) as HTMLElement[])
        : renderFlipGlyphs(element, previousValue);

    if (shouldReduceMotion) {
      displayedValueRef.current = formattedValue;
      displayedNumberRef.current = value;
      const incomingGlyphs = renderFlipGlyphs(element, formattedValue);
      utils.set(incomingGlyphs, { opacity: 0 });
      animationRef.current = animate(incomingGlyphs, {
        duration: 120,
        ease: flipTransitionEase,
        opacity: 1,
        onComplete: () => {
          incomingGlyphs.forEach((glyph) => glyph.removeAttribute("style"));
          animationRef.current = null;
        },
      });
      return () => {
        animationRef.current?.revert();
      };
    }

    animationRef.current = animate(outgoingGlyphs, {
      delay: stagger(FLIP_GLYPH_STAGGER_MS, {
        from: "last",
        start: FLIP_TRANSITION_DELAY_MS,
      }),
      duration: FLIP_OUT_DURATION_MS,
      ease: flipTransitionEase,
      filter: "blur(1px)",
      opacity: 0,
      rotateX: "55deg",
      translateY: "-55%",
      onComplete: () => {
        displayedValueRef.current = formattedValue;
        displayedNumberRef.current = value;
        const incomingGlyphs = renderFlipGlyphs(element, formattedValue);
        utils.set(incomingGlyphs, {
          filter: "blur(1px)",
          opacity: 0,
          rotateX: "-55deg",
          translateY: "55%",
        });
        animationRef.current = animate(incomingGlyphs, {
          delay: stagger(FLIP_GLYPH_STAGGER_MS, { from: "last" }),
          duration: FLIP_IN_DURATION_MS,
          ease: flipTransitionEase,
          filter: "blur(0px)",
          opacity: 1,
          rotateX: "0deg",
          translateY: "0%",
          onComplete: () => {
            incomingGlyphs.forEach((glyph) => glyph.removeAttribute("style"));
            animationRef.current = null;
          },
        });
      },
    });

    return () => {
      animationRef.current?.revert();
    };
  }, [
    animateChanges,
    formattedValue,
    resolvedZeroTransition,
    shouldReduceMotion,
    value,
  ]);

  return (
    <span
      aria-hidden={accessible ? undefined : true}
      className={cn(
        "inline-flex overflow-hidden [perspective:8rem]",
        className,
      )}
      data-motion="flip"
      data-testid={testId}
      data-transition-delay={FLIP_TRANSITION_DELAY_MS}
      data-transition-duration={FLIP_TRANSITION_DURATION_MS}
      data-transition-easing={FLIP_TRANSITION_EASING}
      data-transition-from-zero={resolvedZeroTransition}
      data-value={formattedValue}
    >
      {accessible ? <span className="sr-only">{formattedValue}</span> : null}
      <span
        aria-hidden={accessible ? true : undefined}
        className="inline-flex"
        ref={valueRef}
      />
    </span>
  );
}
