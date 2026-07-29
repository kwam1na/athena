import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { z } from "zod";

import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useStableReportQuery } from "@/components/reports/useStableReportQuery";
import { api } from "~/convex/_generated/api";

import { ReportCustomRangePanel } from "@/components/reports/ReportCustomRangePanel";
import { ReportsCatalogLookup } from "@/components/reports/ReportsCatalogLookup";
import { ReportDaysPanel } from "@/components/reports/ReportDaysPanel";
import { ReportsOverviewView } from "@/components/reports/ReportsOverviewView";
import {
  dateRangeForOverviewWindow,
  REPORT_OVERVIEW_WINDOWS,
  todayOperatingDateGuess,
  type ReportOverviewWindow,
} from "@/components/reports/reportPeriodKeys";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportsOverviewSearchSchema = z.object({
  window: z.enum(REPORT_OVERVIEW_WINDOWS).optional(),
  daysStart: dateSchema.optional(),
  daysEnd: dateSchema.optional(),
  daysPage: z.coerce.number().int().positive().optional(),
  rangeStart: dateSchema.optional(),
  rangeEnd: dateSchema.optional(),
  requestKey: z.string().min(1).optional(),
});

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

  /**
   * The page's three sections each own a query, and each renders nothing
   * until its own data settles. Left alone they paint at different moments —
   * the custom-range panel has nothing to wait for, so it appeared first, at
   * the top of an empty page, and was then shoved ~1200px down when the
   * overview and day list landed above it (measured layout shift: 0.165).
   *
   * Gating the whole page on the overview query — the same document the
   * header content needs, deduplicated by the Convex client, so no extra
   * read — collapses that into a single paint.
   */
  const { data: overview, isInitialLoad } = useStableReportQuery(
    useQuery(
      api.reports.queries.getOverview,
      activeStore?._id ? { storeId: activeStore._id } : "skip",
    ),
  );

  const daysEnd = search.daysEnd ?? isoDateOffset(0);
  const daysStart = search.daysStart ?? isoDateOffset(-13);
  const rangeEnd = search.rangeEnd ?? isoDateOffset(0);
  const rangeStart = search.rangeStart ?? isoDateOffset(-29);
  const selectedWindow = search.window ?? "today";
  const overviewAnchorDate =
    overview?.dailyTrend.at(-1)?.operatingDate ?? todayOperatingDateGuess();
  const detailRange = dateRangeForOverviewWindow(
    selectedWindow,
    overviewAnchorDate,
  );

  if (activeStore === null || isInitialLoad) return null;

  return (
    <div className="space-y-layout-xl md:space-y-layout-2xl">
      <ReportsCatalogLookup
        endDate={detailRange.endDate}
        startDate={detailRange.startDate}
      />
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
        onRangeChange={(next) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              daysStart: next.startDate,
              daysEnd: next.endDate,
              daysPage: undefined,
            }),
          })
        }
        page={search.daysPage ?? 1}
        startDate={daysStart}
      />
      <ReportCustomRangePanel
        endDate={rangeEnd}
        onEndDateChange={(value) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              rangeEnd: value,
              requestKey: undefined,
            }),
          })
        }
        onRequestKeyChange={(requestKey) =>
          void navigate({
            replace: true,
            search: (current) => ({ ...current, requestKey }),
          })
        }
        onStartDateChange={(value) =>
          void navigate({
            replace: true,
            search: (current) => ({
              ...current,
              rangeStart: value,
              requestKey: undefined,
            }),
          })
        }
        requestKey={search.requestKey}
        startDate={rangeStart}
      />
    </div>
  );
}
