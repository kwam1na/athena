import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/utils";
import { AnimatedHeight } from "./AnimatedHeight";

const DATA_STATE_TRANSITION_DURATION_SECONDS = 0.18;
const DATA_STATE_TRANSITION_EASE = [0.23, 1, 0.32, 1] as const;

/**
 * Coordinates data, empty, and similar keyed content states.
 *
 * The current state exits before the next enters, while `AnimatedHeight`
 * smooths the surrounding layout between their intrinsic heights.
 */
export function AnimatedDataState({
  children,
  className,
  stateKey,
  testId,
}: {
  children: ReactNode;
  className?: string;
  stateKey: string;
  testId?: string;
}) {
  const shouldReduceMotion = Boolean(useReducedMotion());
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : {
        duration: DATA_STATE_TRANSITION_DURATION_SECONDS,
        ease: DATA_STATE_TRANSITION_EASE,
      };
  const restingScale = shouldReduceMotion ? 1 : 0.99;

  return (
    <div
      className={cn("w-full", className)}
      data-motion="data-state"
      data-state={stateKey}
      data-testid={testId}
    >
      <AnimatedHeight>
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            data-state={stateKey}
            exit={{ opacity: 0 }}
            initial={{ opacity: 0, scale: restingScale }}
            key={stateKey}
            style={{ transformOrigin: "top center" }}
            transition={transition}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </AnimatedHeight>
    </div>
  );
}
