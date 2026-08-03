import { useSharedDemoContext } from "@/hooks/useSharedDemoContext";

/**
 * How a Reports surface should source its data.
 *
 * The shared demo store has no materialized reporting documents — every number
 * it shows is derived in the browser by `sharedDemoReportsFixture`. So in demo
 * mode the Convex reads are not merely ignored, they are never opened.
 *
 * `useSharedDemoContext` has THREE states and all three matter here:
 *   - `undefined` — the context read has not settled. Holding the live query
 *     until it does is the point: opening a subscription we would immediately
 *     discard is a wasted read on every Reports mount.
 *   - `null` — a real store. Live queries run exactly as before.
 *   - `{ kind: "shared_demo" }` — the fixture answers, live queries stay
 *     skipped.
 *
 * `useLiveQuery` is therefore false for BOTH the pending and the demo state,
 * and `isSharedDemo` is what selects the fixture branch.
 */
export function useReportsSharedDemoMode(): {
  isSharedDemo: boolean;
  isContextPending: boolean;
  useLiveQuery: boolean;
} {
  const sharedDemoContext = useSharedDemoContext();
  const isSharedDemo = sharedDemoContext?.kind === "shared_demo";
  const isContextPending = sharedDemoContext === undefined;

  return {
    isSharedDemo,
    isContextPending,
    useLiveQuery: !isSharedDemo && !isContextPending,
  };
}
