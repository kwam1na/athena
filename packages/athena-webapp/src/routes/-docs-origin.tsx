import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouterState } from "@tanstack/react-router";

import { findDeliveryReport, findSolutionDoc } from "@/lib/docs/content";
import { parseDocsLocation, type DocsTarget } from "@/lib/docs/navigation";
import { formatCategoryLabel } from "./-docs-shared";

export type DocsOrigin = {
  /** Pathname the origin sits at; used to detect a return to it. */
  pathname: string;
  target: DocsTarget;
  label: string;
};

const DocsOriginContext = createContext<DocsOrigin | null>(null);

function describeLocation(
  pathname: string,
  category: string | null,
): DocsOrigin | null {
  const target = parseDocsLocation(pathname, category);
  if (!target) return null;

  let label: string;
  switch (target.kind) {
    case "overview":
      label = "Overview";
      break;
    case "solutions":
      label = target.category
        ? formatCategoryLabel(target.category)
        : "Solution docs";
      break;
    case "reports":
      label = "Delivery reports";
      break;
    case "solutionDoc":
      label =
        findSolutionDoc(target.category, target.slug)?.title ?? "Solution docs";
      break;
    case "report":
      label = findDeliveryReport(target.slug)?.title ?? "Delivery reports";
      break;
  }

  return { pathname, target, label };
}

/**
 * Records where the reader came from as they move through the docs section, so
 * a detail page can offer a back link to that origin instead of always to its
 * own category. Following a chain of cross-references and walking back out of
 * it is the case this exists for.
 *
 * The stack lives in memory and resets when the section unmounts: a freshly
 * opened doc URL has no origin, and should fall back to its category.
 */
export function DocsOriginProvider({ children }: { children: ReactNode }) {
  // Selected as separate primitives so each read is referentially stable.
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const category = useRouterState({
    select: (state) =>
      (state.location.search as { category?: string }).category ?? null,
  });

  const [stack, setStack] = useState<DocsOrigin[]>([]);
  const previousRef = useRef<{ pathname: string; category: string | null } | null>(
    null,
  );

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { pathname, category };
    if (!previous) return;

    // A search-only change is the solutions filter, which navigates with
    // `replace` and so adds no history entry to walk back through.
    if (previous.pathname === pathname) return;

    setStack((current) => {
      const top = current[current.length - 1];
      if (top && top.pathname === pathname) {
        // Returned to the recorded origin, by our back link or the browser's.
        return current.slice(0, -1);
      }
      const origin = describeLocation(previous.pathname, previous.category);
      return origin ? [...current, origin] : current;
    });
  }, [pathname, category]);

  return (
    <DocsOriginContext.Provider value={stack[stack.length - 1] ?? null}>
      {children}
    </DocsOriginContext.Provider>
  );
}

/** The most recent origin, or null when the page was opened directly. */
export function useDocsOrigin(): DocsOrigin | null {
  return useContext(DocsOriginContext);
}
