import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2, RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import type { SharedDemoRestoreOverlayPhase } from "./sharedDemoRestoreOverlayModel";

const presentation = {
  failed: {
    detail: "The store couldn’t be restored.",
    title: "Demo refresh paused",
  },
  preparing: {
    detail: "Updating this browser with the restored store.",
    title: "Preparing the demo",
  },
  restoring: {
    detail: "Restoring the original demo data. This usually takes a moment.",
    title: "Resetting demo store",
  },
} as const;

export function SharedDemoRestoreOverlay({
  isRetrying,
  onRetry,
  phase,
}: {
  isRetrying: boolean;
  onRetry: () => void;
  phase: SharedDemoRestoreOverlayPhase;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const isVisible = phase !== "hidden";
  const currentPresentation = phase === "hidden" ? null : presentation[phase];

  useEffect(() => {
    if (!isVisible) return;
    const appRoot = document.getElementById("app");
    const priorFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const wasInert = appRoot?.inert ?? false;
    if (appRoot) appRoot.inert = true;
    overlayRef.current?.focus();

    return () => {
      if (appRoot) appRoot.inert = wasInert;
      if (priorFocus?.isConnected) priorFocus.focus();
    };
  }, [isVisible]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {isVisible ? (
        <motion.div
          ref={overlayRef}
          key="shared-demo-restore-overlay"
          aria-busy={phase !== "failed"}
          aria-describedby="shared-demo-restore-detail"
          aria-labelledby="shared-demo-restore-title"
          aria-modal="true"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-app-canvas/90 px-layout-md backdrop-blur-xl supports-[backdrop-filter]:bg-app-canvas/75"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          tabIndex={-1}
          transition={{ duration: shouldReduceMotion ? 0.15 : 0.24 }}
        >
          <motion.div
            className="w-full max-w-md text-center"
            initial={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.985, y: 6 }
            }
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={
              shouldReduceMotion
                ? { duration: 0.15 }
                : { bounce: 0, duration: 0.35, type: "spring" }
            }
          >
            {phase === "failed" ? (
              <RotateCcw
                aria-hidden="true"
                className="mx-auto h-5 w-5 text-muted-foreground"
              />
            ) : (
              <Loader2
                aria-hidden="true"
                className="mx-auto h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none"
              />
            )}
            <h1
              id="shared-demo-restore-title"
              className="mt-layout-md font-display text-3xl font-light tracking-tight text-foreground"
            >
              {currentPresentation?.title}
            </h1>
            <p
              id="shared-demo-restore-detail"
              className="mx-auto mt-layout-sm max-w-sm leading-7 text-muted-foreground"
            >
              {currentPresentation?.detail}
            </p>
            {phase === "failed" ? (
              <Button
                type="button"
                className="mt-layout-lg"
                disabled={isRetrying}
                onClick={onRetry}
              >
                {isRetrying ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  />
                ) : null}
                {isRetrying ? "Trying again" : "Try again"}
              </Button>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
