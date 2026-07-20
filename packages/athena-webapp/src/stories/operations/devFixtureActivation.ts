/**
 * Development-only activation for the operations screenshot fixtures.
 *
 * Fixture data is pulled in through **dynamic** imports behind an `import.meta.env.DEV`
 * check. A static import was tried first and did not work: Vite replaces the flag with
 * `false`, but Rollup still retained the fixture objects, and the authored copy shipped in
 * the production bundle. The dynamic form keeps them out — verified by grepping `dist/`.
 * The import specifiers below are string literals so Vite can still analyse them.
 *
 * If you add a fixture module, re-run that check. These render authored operational and
 * financial numbers inside the real app chrome, which is misleading if mistaken for a
 * live store.
 */

import { useEffect, useState } from "react";

import type { DailyCloseViewContentProps } from "@/components/operations/DailyCloseView";
import type { DailyOpeningViewContentProps } from "@/components/operations/DailyOpeningView";
import type { DailyOperationsViewContentProps } from "@/components/operations/DailyOperationsView";
import { setOperatingClockOverride } from "@/lib/operations/operatingDate";

type FixtureEntry<TProps> = { clock: Date; props: TProps };
type FixtureRegistry<TProps> = Record<string, FixtureEntry<TProps>>;

type FixtureState<TProps> = {
  /** True while a named fixture is still loading; render nothing rather than querying. */
  isResolving: boolean;
  fixture?: TProps;
};

const INERT: FixtureState<never> = { isResolving: false };

/**
 * Resolves a `?fixture=` search value to a workspace prop bag, pinning the operating clock
 * to the fixture's day so it renders as the current one.
 *
 * Stays inert in production, for an absent value, or for an unknown name — the workspace
 * then loads normally from Convex. Any previous clock pin is cleared, so navigating away
 * from a fixture restores the real date. While a named fixture is loading, `isResolving`
 * is true so the caller can hold the render; otherwise the workspace would briefly take
 * the Convex path and issue the very queries a fixture exists to avoid.
 *
 * `load` must return a registry via a dynamic `import()` with a literal specifier.
 */
function useWorkspaceFixture<TProps>(
  name: string | undefined,
  load: () => Promise<FixtureRegistry<TProps>>,
): FixtureState<TProps> {
  const isRequested = Boolean(import.meta.env.DEV && name);
  const [state, setState] = useState<FixtureState<TProps>>(() =>
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

    void load().then((registry) => {
      if (cancelled) return;

      const entry = registry[name];

      if (!entry) {
        setOperatingClockOverride(null);
        setState(INERT);
        return;
      }

      setOperatingClockOverride(entry.clock);
      setState({ fixture: entry.props, isResolving: false });
    });

    return () => {
      cancelled = true;
    };
    // `load` is a stable module-literal thunk per call site; keying on `name` is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  return state;
}

export function useDailyOperationsFixture(name?: string) {
  return useWorkspaceFixture<DailyOperationsViewContentProps>(name, () =>
    import("./dailyOperationsFixtures").then((m) => m.dailyOperationsFixtures),
  );
}

export function useDailyOpeningFixture(name?: string) {
  return useWorkspaceFixture<DailyOpeningViewContentProps>(name, () =>
    import("./openingHandoffFixtures").then((m) => m.openingHandoffFixtures),
  );
}

export function useDailyCloseFixture(name?: string) {
  return useWorkspaceFixture<DailyCloseViewContentProps>(name, () =>
    import("./eodReviewFixtures").then((m) => m.eodReviewFixtures),
  );
}
