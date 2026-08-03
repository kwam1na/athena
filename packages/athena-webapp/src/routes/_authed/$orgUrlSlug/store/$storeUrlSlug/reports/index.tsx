import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useMemo } from "react";

import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useReportsSharedDemoMode } from "@/components/reports/useReportsSharedDemoMode";
import { useStableReportQuery } from "@/components/reports/useStableReportQuery";
import { createSharedDemoReportsOverview } from "@/components/shared-demo/sharedDemoReportsFixture";
import { api } from "~/convex/_generated/api";

import { ReportDaysPanel } from "@/components/reports/ReportDaysPanel";
import { ReportsOverviewView } from "@/components/reports/ReportsOverviewView";
import { reportsOverviewSearchSchema } from "@/components/reports/reportRouteSearch";
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
  const navigate = Route.useNavigate();
  const { activeStore } = useGetActiveStore();

  const { isSharedDemo, useLiveQuery } = useReportsSharedDemoMode();

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
    () => (isSharedDemo ? createSharedDemoReportsOverview() : undefined),
    [isSharedDemo],
  );
  const { isInitialLoad } = useStableReportQuery(
    isSharedDemo ? demoOverview : liveOverview,
  );

  const defaultDaysEnd = isoDateOffset(0);
  const defaultDaysStart = isoDateOffset(-13);
  const daysEnd = search.daysEnd ?? defaultDaysEnd;
  const daysStart = search.daysStart ?? defaultDaysStart;
  const daysTableEnd = search.daysTableEnd ?? daysEnd;
  const daysTableStart = search.daysTableStart ?? daysStart;
  const canResetDaysRange =
    daysStart !== defaultDaysStart || daysEnd !== defaultDaysEnd;
  const selectedWindow = search.window ?? "today";
  if (activeStore === null || isInitialLoad) return null;

  return (
    <div className="space-y-layout-xl md:space-y-layout-2xl">
      <ReportsOverviewView
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
            }),
          })
        }
        onSelectedDateChange={(selectedDay) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              selectedDay,
            }),
          })
        }
        page={search.daysPage ?? 1}
        selectedDate={search.selectedDay}
        startDate={daysStart}
        tableEndDate={daysTableEnd}
        tableStartDate={daysTableStart}
      />
    </div>
  );
}
