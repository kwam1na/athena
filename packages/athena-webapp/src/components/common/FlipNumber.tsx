import { useLayoutEffect, useRef } from "react";
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
  value,
}: {
  accessible?: boolean;
  animateChanges?: boolean;
  className?: string;
  formatValue?: (value: number) => string;
  reduceMotion?: boolean;
  skipAnimationFromZero?: boolean;
  testId?: string;
  value: number;
}) {
  const prefersReducedMotion = useReducedMotion();
  const shouldReduceMotion = reduceMotion ?? Boolean(prefersReducedMotion);
  const formattedValue = formatValue(value);
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

    if (!animateChanges || (skipAnimationFromZero && previousNumber === 0)) {
      displayedValueRef.current = formattedValue;
      displayedNumberRef.current = value;
      renderFlipGlyphs(element, formattedValue);
      return;
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
    shouldReduceMotion,
    skipAnimationFromZero,
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
