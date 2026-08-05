import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useMemo } from "react";

import useGetActiveStore from "@/hooks/useGetActiveStore";
import {
  useReportsSharedDemoMode,
  useSharedDemoLiveReportsDay,
} from "@/components/reports/useReportsSharedDemoMode";
import { useStableReportQuery } from "@/components/reports/useStableReportQuery";
import { createSharedDemoReportsOverview } from "@/components/shared-demo/sharedDemoReportsFixture";
import { api } from "~/convex/_generated/api";

import { ReportDaysPanel } from "@/components/reports/ReportDaysPanel";
import { ReportsOverviewView } from "@/components/reports/ReportsOverviewView";
import {
  closedUnitsSheetSearch,
  parseUnitsSheetFocusSearch,
  reportsOverviewSearchSchema,
  resetUnitsSheetContextSearch,
  unitsSheetFocusSearchValue,
} from "@/components/reports/reportRouteSearch";
import { getOrigin } from "~/src/lib/navigationUtils";
import {
  tableRangeIncludingSelection,
  type ReportOverviewWindow,
} from "@/components/reports/reportPeriodKeys";

export { reportsOverviewSearchSchema } from "@/components/reports/reportRouteSearch";

function isoDateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/reports/",
)({
  component: ReportsOverviewRoute,
  validateSearch: reportsOverviewSearchSchema,
});

function ReportsOverviewRoute() {
  const search = Route.useSearch();
  const unitsSheetFocus = parseUnitsSheetFocusSearch(search.unitsFocus);
  const navigate = Route.useNavigate();
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const { activeStore } = useGetActiveStore();

  const { isSharedDemo, useLiveQuery } = useReportsSharedDemoMode();
  const { liveDay, today } = useSharedDemoLiveReportsDay();

  /**
   * Gating the page on the overview query — the same document the header
   * content needs, deduplicated by the Convex client, so no extra read —
   * keeps the report sections from painting at different moments.
   *
   * The shared demo derives the same document in the browser. The fixture is
   * cached per operating date, so the view issuing its own call resolves to
   * the identical projection rather than a second, possibly divergent one.
   */
  const liveOverview = useQuery(
    api.reports.queries.getOverview,
    activeStore?._id && useLiveQuery ? { storeId: activeStore._id } : "skip",
  );
  const demoOverview = useMemo(
    () =>
      isSharedDemo
        ? createSharedDemoReportsOverview(today, liveDay)
        : undefined,
    [isSharedDemo, liveDay, today],
  );
  const {
    data: overview,
    isInitialLoad,
    isRefreshing,
  } = useStableReportQuery(isSharedDemo ? demoOverview : liveOverview);

  const defaultDaysEnd = isoDateOffset(0);
  const defaultDaysStart = isoDateOffset(-13);
  const daysEnd = search.daysEnd ?? defaultDaysEnd;
  const daysStart = search.daysStart ?? defaultDaysStart;
  const daysTableEnd = search.daysTableEnd ?? daysEnd;
  const daysTableStart = search.daysTableStart ?? daysStart;
  const canResetDaysRange =
    daysStart !== defaultDaysStart || daysEnd !== defaultDaysEnd;
  const selectedWindow = search.window ?? "today";
  // The single gate for the whole page: children receive settled data as
  // props and never re-derive it, so they cannot settle on different commits
  // and paint each other's positions (see ReportsOverviewView's doc comment).
  if (activeStore === null || isInitialLoad || overview === undefined) {
    return null;
  }

  return (
    <div className="space-y-layout-xl md:space-y-layout-2xl">
      <ReportsOverviewView
        isRefreshing={isRefreshing}
        overview={overview}
        onSelectedWindowChange={(window: ReportOverviewWindow) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              window: window === "today" ? undefined : window,
            }),
          })
        }
        selectedWindow={selectedWindow}
      />
      <ReportDaysPanel
        canResetRange={canResetDaysRange}
        endDate={daysEnd}
        isUnitsSheetOpen={search.units}
        onPageChange={(daysPage) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              daysPage: daysPage === 1 ? undefined : daysPage,
            }),
          })
        }
        onRangeChange={(next, targetPage) => {
          const nextTableRange = tableRangeIncludingSelection(
            { startDate: daysTableStart, endDate: daysTableEnd },
            next,
          );
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              daysStart: next.startDate,
              daysEnd: next.endDate,
              daysTableStart: nextTableRange.startDate,
              daysTableEnd: nextTableRange.endDate,
              daysPage: targetPage === 1 ? undefined : targetPage,
              selectedDay: undefined,
              ...resetUnitsSheetContextSearch,
            }),
          });
        }}
        onRangeReset={() =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              daysStart: undefined,
              daysEnd: undefined,
              daysPage: undefined,
              selectedDay: undefined,
              ...resetUnitsSheetContextSearch,
            }),
          })
        }
        onSelectedDateChange={(selectedDay) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              selectedDay,
              ...resetUnitsSheetContextSearch,
            }),
          })
        }
        onUnitsSheetOpenChange={(units) =>
          void navigate({
            replace: true,
            search: (current) =>
              units
                ? { ...current, units: true }
                : { ...current, ...closedUnitsSheetSearch },
          })
        }
        onUnitsSheetPageChange={(unitsPage) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              unitsPage: unitsPage === 1 ? undefined : unitsPage,
            }),
          })
        }
        onUnitsSheetRestoreComplete={() =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              unitsFocus: undefined,
              unitsScroll: undefined,
            }),
          })
        }
        onUnitsSheetSkuLinkNavigate={({
          endDate,
          focusSurface,
          productSkuId,
          scrollOffset,
          startDate,
        }) => {
          const unitsScroll =
            scrollOffset !== undefined &&
            Number.isFinite(scrollOffset) &&
            scrollOffset > 0
              ? Math.round(scrollOffset)
              : undefined;
          // Continuity keys are replaced into the reports URL first so both
          // the detail origin (`o`) and the history entry browser Back lands
          // on carry them; the drill-down itself stays a real push entry.
          return Promise.resolve(
            navigate({
              replace: true,
              search: (current) => ({
                ...current,
                unitsFocus: unitsSheetFocusSearchValue(
                  productSkuId,
                  focusSurface,
                ),
                unitsScroll,
              }),
            }),
          ).then(() => {
            const detailNavigation = navigate({
              params: {
                orgUrlSlug: orgUrlSlug!,
                productSkuId,
                storeUrlSlug: storeUrlSlug!,
              },
              search: { endDate, o: getOrigin(), startDate },
              to: "/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId",
            });
            return detailNavigation;
          });
        }}
        onUnitsSheetTabChange={(tab) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              unitsTab: tab === "granular" ? "granular" : undefined,
              unitsPage: undefined,
            }),
          })
        }
        page={search.daysPage ?? 1}
        selectedDate={search.selectedDay}
        unitsSheetPage={search.unitsPage ?? 1}
        unitsSheetRestoreFocusSkuId={unitsSheetFocus.productSkuId}
        unitsSheetRestoreFocusSurface={unitsSheetFocus.surface}
        unitsSheetRestoreScrollOffset={search.unitsScroll}
        unitsSheetTab={search.unitsTab ?? "top"}
        startDate={daysStart}
        tableEndDate={daysTableEnd}
        tableStartDate={daysTableStart}
      />
    </div>
  );
}
