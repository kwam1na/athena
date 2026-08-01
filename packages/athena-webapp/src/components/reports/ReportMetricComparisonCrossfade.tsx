import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

export function ReportMetricComparisonCrossfade({
  children,
  comparisonKey,
  comparisonState = comparisonKey,
}: {
  children: ReactNode;
  comparisonKey: string;
  comparisonState?: string;
}) {
  const shouldReduceMotion = Boolean(useReducedMotion());
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.16, ease: [0.23, 1, 0.32, 1] as const };

  return (
    <span
      className="grid min-h-5"
      data-comparison-key={comparisonState}
      data-motion="comparison-crossfade"
    >
      <AnimatePresence initial={false}>
        <motion.span
          animate={{ opacity: 1 }}
          className="col-start-1 row-start-1 block min-w-0"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          key={comparisonKey}
          transition={transition}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
