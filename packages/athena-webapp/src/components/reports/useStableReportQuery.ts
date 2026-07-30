import { useEffect, useRef } from "react";

/**
 * Stale-while-refreshing for Convex queries.
 *
 * `useQuery` returns `undefined` every time its args change, not just on the
 * first load. Rendering a skeleton on `undefined` therefore tears the whole
 * panel down and back up on each date/period change, which reads as a
 * full-page flash. This keeps the last settled value on screen while the new
 * one resolves, so only the numbers change — the layout never collapses.
 *
 * `isRefreshing` is for a quiet affordance (dimming, aria-busy), never for
 * swapping in a skeleton: a skeleton is correct only when there is nothing
 * to show yet, which is exactly `data === undefined && !isRefreshing`.
 */
export function useStableReportQuery<T, TContext = undefined>(
  value: T | undefined,
  context?: TContext,
): {
  data: T | undefined;
  dataContext: TContext | undefined;
  isInitialLoad: boolean;
  isRefreshing: boolean;
} {
  const settled = useRef<
    { data: T; dataContext: TContext | undefined } | undefined
  >(undefined);

  useEffect(() => {
    if (value !== undefined) {
      settled.current = { data: value, dataContext: context };
    }
  }, [context, value]);

  if (value !== undefined) {
    return {
      data: value,
      dataContext: context,
      isInitialLoad: false,
      isRefreshing: false,
    };
  }

  // Ref updates land in an effect, so read through to the freshest value the
  // render pass has already seen rather than waiting a frame.
  const previous = settled.current;

  return {
    data: previous?.data,
    dataContext: previous?.dataContext,
    isInitialLoad: previous === undefined,
    isRefreshing: previous !== undefined,
  };
}
