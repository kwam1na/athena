import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeftFromLine, Home } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { PUBLIC_HOME_PATH } from "@/lib/navigation/appEntryRoutes";

function normalizePathname(pathname: string) {
  return pathname.replace(/\/+$/, "") || "/";
}

export function SharedDemoStatusBar({
  currentPathname,
  homeHref,
}: {
  currentPathname: string;
  homeHref: string;
}) {
  const shouldReduceMotion = useReducedMotion();
  const isOwnerHome =
    normalizePathname(currentPathname) === normalizePathname(homeHref);

  return (
    <div
      aria-label="Demo controls"
      className="flex shrink-0 items-center gap-1 sm:gap-layout-xs"
    >
      <AnimatePresence>
        {!isOwnerHome ? (
          <motion.span
            key="shared-demo-hourly-reset-guidance"
            animate={{ opacity: 1, y: 0 }}
            className="hidden items-center gap-layout-xs whitespace-nowrap text-xs font-medium text-muted-foreground xl:inline-flex"
            exit={{ opacity: 0, y: shouldReduceMotion ? 0 : 4 }}
            initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 4 }}
            transition={{
              duration: shouldReduceMotion ? 0.15 : 0.24,
              ease: [0.23, 1, 0.32, 1],
            }}
          >
            Demo resets at the start of every hour
          </motion.span>
        ) : null}
      </AnimatePresence>
      <Button asChild variant="utility" size="sm">
        <Link to={homeHref} aria-label="Demo guide">
          <Home aria-hidden="true" />
          <span className="hidden lg:inline">Demo guide</span>
        </Link>
      </Button>
      <Button asChild variant="utility" size="sm">
        <Link to={PUBLIC_HOME_PATH}>
          <ArrowLeftFromLine aria-hidden="true" />
          <span>Exit demo</span>
        </Link>
      </Button>
    </div>
  );
}
