/**
 * Development-only activation for the operations screenshot fixtures.
 *
 * Fixture data is pulled in through a **dynamic** import behind an `import.meta.env.DEV`
 * check. A static import was tried first and did not work: Vite replaces the flag with
 * `false`, but Rollup still retained the fixture object, and the authored copy shipped in
 * the production bundle. The dynamic form keeps it out — verified by grepping `dist/`.
 *
 * If you add a fixture module, re-run that check. These render authored operational and
 * financial numbers inside the real app chrome, which is misleading if mistaken for a
 * live store.
 */

import { useEffect, useState } from "react";

import type { DailyOperationsViewContentProps } from "@/components/operations/DailyOperationsView";
import { setOperatingClockOverride } from "@/lib/operations/operatingDate";

type DailyOperationsFixtureState = {
  /** True while a named fixture is still loading; render nothing rather than querying. */
  isResolving: boolean;
  fixture?: DailyOperationsViewContentProps;
};

const INERT: DailyOperationsFixtureState = { isResolving: false };

/**
 * Resolves a `?fixture=` search value to a Daily Operations prop bag, pinning the
 * operating clock to the fixture's day so it renders as the current one.
 *
 * Stays inert in production, for an absent value, or for an unknown name — the workspace
 * then loads normally from Convex. Any previous clock pin is cleared, so navigating away
 * from a fixture restores the real date.
 *
 * While a named fixture is loading, `isResolving` is true so the caller can hold the
 * render. Without that hold the workspace would briefly take the Convex path and issue
 * the very queries a fixture exists to avoid.
 */
export function useDailyOperationsFixture(
  name?: string,
): DailyOperationsFixtureState {
  const isRequested = Boolean(import.meta.env.DEV && name);
  const [state, setState] = useState<DailyOperationsFixtureState>(() =>
    isRequested ? { isResolving: true } : INERT,
  );

  useEffect(() => {
    if (!import.meta.env.DEV || !name) {
      setOperatingClockOverride(null);
      setState(INERT);
      return;
    }

    let cancelled = false;
    setState({ isResolving: true });

    void import("./dailyOperationsFixtures").then(
      ({ dailyOperationsFixtures }) => {
        if (cancelled) return;

        const entry =
          dailyOperationsFixtures[
            name as keyof typeof dailyOperationsFixtures
          ];

        if (!entry) {
          setOperatingClockOverride(null);
          setState(INERT);
          return;
        }

        setOperatingClockOverride(entry.clock);
        setState({ fixture: entry.props, isResolving: false });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [name]);

  return state;
}
