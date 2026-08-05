import { useMemo } from "react";
import { useQuery } from "convex/react";

import { api } from "~/convex/_generated/api";
import { useSharedDemoContext } from "@/hooks/useSharedDemoContext";
import { useStoreOperatingDate } from "@/hooks/useStoreOperatingClock";
import {
  toSharedDemoLiveReportsDay,
  toSharedDemoLiveSkuStock,
  type SharedDemoLiveReportsDay,
} from "@/components/shared-demo/sharedDemoLiveReportsDay";

/**
 * How a Reports surface should source its data.
 *
 * In demo mode the fixture (`sharedDemoReportsFixture`) answers every read it
 * CAN answer — the 21-day history — so those Convex reads are not merely
 * ignored, they are never opened. The one read the fixture cannot answer is
 * the CURRENT operating day: the demo store's own POS sales materialize real
 * `reportDay`/`reportSkuDay` rows, and `useSharedDemoLiveReportsDay` (below)
 * subscribes to exactly that and folds it onto the fixture history.
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

/**
 * The demo's live current day, ready to fold onto the fixture history.
 *
 * The ONE Convex read a Reports surface opens in demo mode. It is deliberately
 * `reports/liveDay` and not `getOverview`: `reportDay` and `reportSkuDay` are
 * patched inside the sale's own transaction, while the overview singleton and
 * the period rollups are sweeper-written on a five-minute interval. A visitor
 * who rings a sale and looks at Reports must see it immediately, not after the
 * next sweep.
 *
 * `today` rides along because it is the operating date in the STORE's zone and
 * it rolls at the store's own midnight. Callers pass it back into the fixture
 * creators so the history rail and the live day always name the same day.
 */
export function useSharedDemoLiveReportsDay(): {
  liveDay: SharedDemoLiveReportsDay | null;
  liveStock: Map<string, number> | null;
  today: string;
} {
  const sharedDemoContext = useSharedDemoContext();
  const today = useStoreOperatingDate();
  const isSharedDemo = sharedDemoContext?.kind === "shared_demo";
  const result = useQuery(
    api.reports.liveDay.getLiveOperatingDay,
    isSharedDemo
      ? { operatingDate: today, storeId: sharedDemoContext.storeId }
      : "skip",
  );
  // Stock is not day-scoped, so it is its own read rather than a lane on the
  // day: the demo's SKU identity is fixture-derived, and its catalogue stock
  // figure never moves while the real rows it describes are decremented by a
  // visitor's sale.
  const stockRows = useQuery(
    api.reports.liveDay.listLiveSkuStock,
    isSharedDemo ? { storeId: sharedDemoContext.storeId } : "skip",
  );

  return useMemo(
    () => ({
      liveDay: toSharedDemoLiveReportsDay({ result, today }),
      liveStock: toSharedDemoLiveSkuStock(stockRows),
      today,
    }),
    [result, stockRows, today],
  );
}
